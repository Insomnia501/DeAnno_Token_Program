# DeAnno_Token_Program
DeAnno - Solana SPL token

## Introduction
The features are as follows:

- Initialization: Initialize our token (DAN) and set up initial parameters.
- Initialize Worker: When a worker logs in for the first time, initialize a Program Derived Address (PDA) to store the worker's personal data.
- Initialize Demander: When a demander logs in for the first time, initialize a PDA to store the demander's personal data.
- Token Distribution: Distribute corresponding token rewards for the work done by the worker.
- Token Exchange: Allow workers to exchange tokens for stablecoins.

## Quickstart

```
// init
yarn
// compile program
anchor build
// make a local validator
solana-test-validator -r --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s tests/dep/metadata.so
// test
anchor test --skip-local-validator 
```







