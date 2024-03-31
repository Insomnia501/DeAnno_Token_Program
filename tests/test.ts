import * as anchor from "@coral-xyz/anchor"
import { Program } from "@coral-xyz/anchor"
import { DeAnnoTokenProgram } from "../target/types/de_anno_token_program"
import * as spl from "@solana/spl-token"
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js"
import { assert } from "chai"
import { amount, Metaplex } from "@metaplex-foundation/js"
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata"

describe("de-anno-token-program", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env())

  const program = anchor.workspace.DeAnnoTokenProgram as Program<DeAnnoTokenProgram>
  const wallet = anchor.workspace.DeAnnoTokenProgram.provider.wallet
  const connection = program.provider.connection
  const metaplex = Metaplex.make(connection)
  const token_metadata_program_id = new anchor.web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")

  const worker = new anchor.web3.PublicKey('HpEdSJaqUNQkHY26snzjEE6JBiyAy5nP1m3yvCirxhB5')
  const demander = new anchor.web3.PublicKey('5ypQbn1GkctugJa8kMPkR3ebzVy396C7wto5waNXPiWq')

  // PDA for the token mint——给合约创建了一个tokenMintsPDA，solana上合约程序和存储分离，可以理解为这是token program的存储账户
  const [deannoTokenMintPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("deanno")],
    program.programId
  )

  // PDA (usdc token mint)
  const usdcTokenMint = new anchor.web3.PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")

  // PDA for the deanno data account——给合约创建一个PDA，用来存初始化的数据
  const [deannoDataPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("init")],
    program.programId
  )

  // PDA for the data account——给worker创建一个PDA，用来存用户自己的数据
  const [workerPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("worker"), worker.toBuffer()],
    program.programId
  )

  // PDA for the data account——给demander创建一个PDA，用来存用户自己的数据
  const [demanderPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("demander"), demander.toBuffer()],
    program.programId
  )

  // worker associated token account address——给worker创建一个ATA，用来存deannoToken
  const workerTokenAccount = spl.getAssociatedTokenAddressSync(
    deannoTokenMintPDA,
    worker
  )

  // program associated token account address——给合约本身创建一个ATA，用来存deannoToken
  // 
  const deannoTokenAccount = spl.getAssociatedTokenAddressSync(
    deannoTokenMintPDA,
    deannoDataPDA,
    true
  )

  // worker usdc associated token account address——worker的usdc ATA
  const workerUSDCAccount = spl.getAssociatedTokenAddressSync(
    usdcTokenMint,
    worker
  )

  // program usdc associated token account address——合约的usdc ATA
  const deannoUSDCAccount = spl.getAssociatedTokenAddressSync(
    usdcTokenMint,
    deannoDataPDA,
    true
  )

  // todo: 给deannoUSDCAccount转一些usdc

  // token metadata
  const metadata = {
    uri: "https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json",
    name: "DeAnno",
    symbol: "DAN",
  }

  it("Initialize", async () => {
    // PDA for the token metadata account for the deanno token mint创建一个tokenMints的metadata的PDA，不明白为啥这还要单独一个account
    const deannoTokenMintMetadataPDA = await metaplex
      .nfts()
      .pdas()
      .metadata({ mint: deannoTokenMintPDA })

    const token_price_init = new anchor.BN(1)
    const withdraw_percent_init = new anchor.BN(50)

    const tx = await program.methods
      .initialize(metadata.uri, metadata.name, metadata.symbol, token_price_init, withdraw_percent_init)
      .accounts({
        deannoTokenMint: deannoTokenMintPDA,
        metadataAccount: deannoTokenMintMetadataPDA,
        tokenMetadataProgram: token_metadata_program_id,
        initData: deannoDataPDA
      })
      .rpc()
    console.log("Your transaction signature", tx)

    const initData = await program.account.initData.fetch(deannoDataPDA)
    const withdrawPercentGT = new anchor.BN(50)
    assert(initData.withdrawPercent === withdrawPercentGT)
  })

  it("Init Worker", async () => {
    const tx = await program.methods
      .initWorker()
      .accounts({
        worker: worker,
        workerData: workerPDA,
      })
      .rpc()
    console.log("Your transaction signature", tx)

    const workerData = await program.account.workerData.fetch(workerPDA)
    const withdrawLimitGT = new anchor.BN(0)
    assert(workerData.withdrawLimit === withdrawLimitGT)
  })

  it("Init Demander", async () => {
    const tx = await program.methods
      .initDemander()
      .accounts({
        demander: demander,
        demanderData: demanderPDA,
      })
      .rpc()
    console.log("Your transaction signature", tx)

    const demanderData = await program.account.demanderData.fetch(demanderPDA)
    const balanceGT = new anchor.BN(0)
    assert(demanderData.balance === balanceGT)
  })

  it("Token Distribution", async () => {
    const amount = new anchor.BN(50)
    const tx = await program.methods
      .tokenDistribution(amount)
      .accounts({
        payer: wallet,
        worker: worker,
        demander: demander,
        demanderData: demanderPDA,
        workerData: workerPDA,
        initData: deannoDataPDA,
        workerTokenAccount: workerTokenAccount,
        deannoTokenMint: deannoTokenMintPDA,
      })
      .rpc()
    console.log("Your transaction signature", tx)

    // Check that 1 token was minted to the player's token account
    assert.strictEqual(
      Number(
        (await connection.getTokenAccountBalance(workerTokenAccount)).value
          .amount
      ),
      50
    )
  })

  it("worker withdraw", async () => {
    const amount = new anchor.BN(50)
    const tx = await program.methods
      .workerWithdraw(amount)
      .accounts({
        worker: worker,
        workerData: workerPDA,
        initData: deannoDataPDA,
        workerTokenAccount: workerTokenAccount,
        workerUsdcAccount: workerUSDCAccount,
        deannoTokenAccount: deannoTokenAccount,
        deannoUsdcAccount: deannoUSDCAccount,
        deannoTokenMint: deannoTokenMintPDA,
        usdcMint: usdcTokenMint
      })
      .rpc()
    console.log("Your transaction signature", tx)

    // Check that 1 token was burned from the player's token account
    assert.strictEqual(
      Number(
        (await connection.getTokenAccountBalance(workerUSDCAccount)).value
          .amount
      ),
      50
    )
    assert.strictEqual(
      Number(
        (await connection.getTokenAccountBalance(workerTokenAccount)).value
          .amount
      ),
      0
    )
  })
  
})