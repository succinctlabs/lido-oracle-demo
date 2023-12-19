import { ConsensusClient } from "@succinctlabs/circomx";
import axios from "axios";
import {
  Chain,
  GetContractReturnType,
  Hex,
  PrivateKeyAccount,
  PublicClient,
  WalletClient,
  createPublicClient,
  createWalletClient,
  getContract,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { goerli, holesky, mainnet } from "viem/chains";
import {
  LIDO_ACCOUNTING_ORACLE_ABI,
  LIDO_HASH_CONSENSUS_ABI,
  LIDO_LOCATOR_ABI,
  SUCCINCT_LIDO_ORACLE_V1_ABI,
} from "./abi.js";
import { Config } from "./config.js";
import { hashBeaconBlockHeader, toHexString, tryGetHeader } from "./util.js";

type ParentClient = {
  source: PublicClient;
  target: PublicClient;
  wallet: WalletClient;
  consensus: ConsensusClient;
};

export class Operator {
  config: Config;
  client: ParentClient;
  account: PrivateKeyAccount;
  chain: Chain;

  succinctOracle?: GetContractReturnType<
    typeof SUCCINCT_LIDO_ORACLE_V1_ABI,
    PublicClient,
    WalletClient
  >;
  lidoHashConsensus?: GetContractReturnType<
    typeof LIDO_HASH_CONSENSUS_ABI,
    PublicClient,
    WalletClient
  >;
  initialEpoch?: bigint;
  stopped = false;

  constructor(config: Config) {
    this.config = config;
    console.log("Using config:", config);

    switch (config.chainId) {
      case 1:
        this.chain = mainnet;
        break;
      case 5:
        this.chain = goerli;
        break;
      case 17000:
        this.chain = holesky;
        break;
      default:
        throw new Error(`No chain found for chain id ${config.chainId}`);
    }

    const sourceRpc = process.env[`RPC_${config.consensusChainId}`];
    if (!sourceRpc) {
      throw new Error(
        `No source rpc url found for chain id ${config.consensusChainId}`
      );
    }
    const sourceTransport = http(sourceRpc);
    const sourceClient = createPublicClient({
      chain: this.chain,
      transport: sourceTransport,
    });
    const rpc = process.env[`RPC_${config.chainId}`];
    if (!rpc) {
      throw new Error(`No rpc url found for chain id ${config.chainId}`);
    }
    const transport = http(rpc);
    const targetClient = createPublicClient({
      chain: this.chain,
      transport,
    });
    const walletClient = createWalletClient({
      chain: this.chain,
      transport,
    });
    const envKey = process.env.PRIVATE_KEY || "";
    const key = envKey.startsWith("0x")
      ? (envKey as Hex)
      : (`0x${envKey}` as const);
    this.account = privateKeyToAccount(key);

    const consensusRpc = process.env[`CONSENSUS_RPC_${config.chainId}`];
    if (!consensusRpc) {
      throw new Error(
        `No consensus rpc url found for chain id ${config.chainId}`
      );
    }
    const client = axios.create({
      baseURL: consensusRpc,
      responseType: "json",
      headers: { "Content-Type": "application/json" },
    });
    const beaconClient = new ConsensusClient(client, 32, 8192);

    this.client = {
      source: sourceClient,
      target: targetClient,
      wallet: walletClient,
      consensus: beaconClient,
    };
  }

  async initialize() {
    console.log("Initializaing operator...");
    this.succinctOracle = getContract({
      abi: SUCCINCT_LIDO_ORACLE_V1_ABI,
      address: this.config.succinctOracleAddress,
      publicClient: this.client.target,
      walletClient: this.client.wallet,
    });

    const lidoLocator = getContract({
      abi: LIDO_LOCATOR_ABI,
      address: this.config.lidoLocatorAddress,
      publicClient: this.client.source,
    });

    const accountingOracleAddress = await lidoLocator.read.accountingOracle();

    const lidoAccountingOracle = getContract({
      abi: LIDO_ACCOUNTING_ORACLE_ABI,
      address: accountingOracleAddress,
      publicClient: this.client.source,
    });

    const lidoHashConsensusAddress =
      await lidoAccountingOracle.read.getConsensusContract();

    this.lidoHashConsensus = getContract({
      abi: LIDO_HASH_CONSENSUS_ABI,
      address: lidoHashConsensusAddress,
      publicClient: this.client.source,
    });

    [this.initialEpoch] = await this.lidoHashConsensus.read.getFrameConfig();

    console.log("Initial epoch:", this.initialEpoch);
  }

  async start() {
    try {
      await this.initialize();
    } catch (e) {
      console.error("Error initializing:", e);
      return;
    }

    process.on("SIGINT", () => {
      if (this.stopped) {
        console.log("Force stopping..");
        process.exit();
      } else {
        console.log("Stopping.. (Ctrl-C again to force)");
        this.stopped = true;
      }
    });

    console.log("Starting operator...");
    await this.run();
  }

  async run() {
    while (!this.stopped) {
      const startTime = Date.now();
      console.log("Running loop at " + new Date().toISOString());
      await this.loop();
      console.log("Finished after " + (Date.now() - startTime) / 1000 + "sec.");

      const [currentRefSlot] =
        await this.lidoHashConsensus!.read.getCurrentFrame();
      const nextFrameSlot = Number(currentRefSlot) + 225 * 32;
      const currentSlot = await this.client.consensus
        .getHeader("finalized")
        .then((header) => header.slot);
      const timeToSleep = Math.max(
        (nextFrameSlot - currentSlot) * 12 * 1000,
        0
      );

      console.log(
        `Next frame slot: ${nextFrameSlot} / Current slot: ${currentSlot}`
      );
      console.log("Sleeping for " + timeToSleep / 1000 / 1000 + "min.");
      await new Promise((resolve) => setTimeout(resolve, timeToSleep));
    }
  }

  async loop() {
    try {
      const [refSlot, deadlineSlot] =
        await this.lidoHashConsensus!.read.getCurrentFrame();

      console.log("Ref slot:", refSlot);

      // Check if succinct oracle has refSlot
      const [alreadyRequested, alreadyReceived] =
        await this.succinctOracle!.read.reports([refSlot]);
      console.log("alreadyRequested:", alreadyRequested);
      console.log("alreadyReceived:", alreadyReceived);
      if (!alreadyReceived) {
        console.log("Succinct oracle does not have ref slot, requesting");

        if (alreadyRequested) {
          console.log("Already requested, skipping");
          return;
        }

        const finalizedHeader = await this.client.consensus.getHeader(
          "finalized"
        );
        if (finalizedHeader.slot >= deadlineSlot) {
          console.log("Finalized header is past deadline slot, skipping");
          return;
        }
        const header = await getFirstNonMissedSlot(
          this.client.consensus,
          Number(refSlot),
          finalizedHeader.slot
        );
        const blockRoot = toHexString(hashBeaconBlockHeader(header)) as Hex;
        console.log("Requesting update: ", blockRoot, refSlot);
        // await this.succinctOracle!.write.requestUpdate(
        //   [blockRoot, refSlot, 500000],
        //   {
        //     account: this.account,
        //     chain: this.chain,
        //   }
        // );
      } else {
        console.log("Succinct oracle has ref slot");
      }
    } catch (e) {
      console.error("Error in loop:", e);
    }
  }
}

// https://github.com/lidofinance/lido-oracle/blob/74265f4d641d69774fc97caebc22e7c3ff84ace5/src/utils/slot.py#L25
async function getFirstNonMissedSlot(
  client: ConsensusClient,
  targetSlot: number,
  finalizedSlot: number
) {
  console.log("Getting first non-missed slot", targetSlot, finalizedSlot);
  for (let i = targetSlot; i <= finalizedSlot; i++) {
    console.log("Trying slot:", i);
    const header = await tryGetHeader(client, i);
    if (header) return header;
  }
  throw new Error("No non-missed slot found");
}
