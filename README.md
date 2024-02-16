# Lido X

A trustless replacement to the [Lido Accounting Oracle](https://docs.lido.fi/contracts/accounting-oracle/), powered by ZK. In particular, we calculate the following statistics every 225 epochs:

- [clBalancesGwei](https://github.com/lidofinance/lido-dao/blob/cadffa46a2b8ed6cfa1127fca2468bae1a82d6bf/contracts/0.8.9/oracle/AccountingOracle.sol#L212): cumulative balance of all Lido validators on the consensus lay
- [numValidators](https://github.com/lidofinance/lido-dao/blob/cadffa46a2b8ed6cfa1127fca2468bae1a82d6bf/contracts/0.8.9/oracle/AccountingOracle.sol#L208): the number of Lido-participating validators on consensus layer that ever appeared (deposited + activated)
- [numExitedValidators](https://github.com/lidofinance/lido-dao/blob/cadffa46a2b8ed6cfa1127fca2468bae1a82d6bf/contracts/0.8.9/oracle/AccountingOracle.sol#L222): the number of Lido-participating exited validators on the consensus layer that ever appeared

The circuit is built using the [plonky2x](https://github.com/succinctlabs/succinctx) proving system and system is deployed end-to-end
with [Succinct](alpha.succinct.xyz). You can explore the generated proofs [here](https://alpha.succinct.xyz/succinctlabs/lido-oracle-demo).

For more details, refer to the [original grant proposal](https://research.lido.fi/t/zk-lido-oracle-powered-by-succinct/5747) that was submitted to the Lido DAO.

## Installation

To run the test locally, set `CONSENSUS_RPC_URL` to a mainnet consensus node and run the following command:

```
RUST_LOG=debug cargo test test_circuit --release -- --nocapture
```

## Contracts

To deploy the contract onchain:

```
cd contracts
bash script/deploy.sh
```

To send an example request to the contract:

```
cd contracts
bash script/request.sh
```

## Operator

To run the operator:

```
cd operator
cp .env.example .env
yarn install
yarn build && yarn cli run <config-name>
```

Config is located at `operator/src/config.ts`

## Holesky Deployment

More details coming soon!

## Sepolia Deployment

Contract Address: [0x36B2EC6419e085cFE06CBF2C70C56dF05F090686](https://sepolia.etherscan.io/address/0x36B2EC6419e085cFE06CBF2C70C56dF05F090686)

Fulfill Transaction: [0xf0858e2180170a3b9b7fe31f09648e2d4544590be3eaca0ca8e14c1c00d1b341](https://goerli.etherscan.io/tx/0xf0858e2180170a3b9b7fe31f09648e2d4544590be3eaca0ca8e14c1c00d1b341)

## Security

This code has not yet been fully audited, and should not be used in any production systems.
