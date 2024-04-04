import * as anchor from "@coral-xyz/anchor"
import { Program } from "@coral-xyz/anchor"
import { DeAnnoTokenProgram } from "../target/types/de_anno_token_program"
import * as spl from "@solana/spl-token"
import { assert } from "chai"
import { amount, Metaplex } from "@metaplex-foundation/js"
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata"
import * as fs from 'fs';

describe("de-anno-token-program", async () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env())

  const program = anchor.workspace.DeAnnoTokenProgram as Program<DeAnnoTokenProgram>
  const wallet = anchor.workspace.DeAnnoTokenProgram.provider.wallet
  const connection = program.provider.connection
  const metaplex = Metaplex.make(connection)
  
  const privateKeyJson = "/Users/daniel/Code/07_Solana/.Solana_wallet/test_wallet_1.json"
  const privateKeyString = fs.readFileSync(privateKeyJson, { encoding: 'utf8' });
  // 将JSON字符串转换为Uint8Array
  const privateKeyUint8Array = new Uint8Array(JSON.parse(privateKeyString));
  // 从私钥创建Keypair
  const admin = anchor.web3.Keypair.fromSecretKey(privateKeyUint8Array);

  const worker = anchor.web3.Keypair.generate()
  const demander = anchor.web3.Keypair.generate()
  connection.requestAirdrop(worker.publicKey, 2*anchor.web3.LAMPORTS_PER_SOL)
  connection.requestAirdrop(demander.publicKey, 2*anchor.web3.LAMPORTS_PER_SOL)


  // PDA for the token mint——给合约创建了一个tokenMintsPDA，solana上合约程序和存储分离，可以理解为这是token program的存储账户
  const [deannoTokenMintPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("deanno")],
    program.programId
  )

  // PDA for the deanno data account——给合约创建一个PDA，用来存初始化的数据
  const [deannoDataPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("init")],
    program.programId
  )

  // PDA for the data account——给worker创建一个PDA，用来存用户自己的数据
  const [workerPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("worker"), worker.publicKey.toBuffer()],
    program.programId
  )

  // PDA for the data account——给demander创建一个PDA，用来存用户自己的数据
  const [demanderPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("demander"), demander.publicKey.toBuffer()],
    program.programId
  )

  // worker associated token account address——给worker创建一个ATA，用来存deannoToken
  const workerTokenAccount = await spl.createAssociatedTokenAccount(
    connection,
    admin,
    deannoTokenMintPDA,
    worker.publicKey
  )

  // program associated token account address——给合约本身创建一个ATA，用来存deannoToken
  const deannoTokenAccount = await spl.createAssociatedTokenAccount(
    connection,
    admin,
    deannoTokenMintPDA,
    deannoDataPDA
  )

  // 造一个测试用的币，当作usdc
  console.log("start")
  const usdcTokenMint = await spl.createMint(
    connection,
    admin,
    admin.publicKey,
    null,
    6, // 小数位数，USDC 通常有6位小数
  );
  console.log(typeof usdcTokenMint)

  // worker usdc associated token account address——worker的usdc ATA
  const workerUSDCAccount = await spl.createAssociatedTokenAccount(
    connection,
    admin,
    usdcTokenMint,
    worker.publicKey
  )
  console.log(typeof workerUSDCAccount)

  // program usdc associated token account address——合约的usdc ATA
  const deannoUSDCAccount = await spl.createAssociatedTokenAccount(
    connection,
    admin,
    usdcTokenMint,
    deannoDataPDA,
  )
  console.log(typeof deannoUSDCAccount)

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
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        initData: deannoDataPDA
      })
      .rpc()
    console.log("Your transaction signature", tx)

    const initData = await program.account.initData.fetch(deannoDataPDA)
    assert.strictEqual(
      Number(
        initData.withdrawPercent
      ),
      50
    )
  })

  it("Init Worker", async () => {
    const withdraw_limit_init = new anchor.BN(100)
    const tx = await program.methods
      .initWorker(withdraw_limit_init)
      .accounts({
        worker: worker.publicKey,
        workerData: workerPDA,
      })
      .signers([worker])
      .rpc()
    console.log("Your transaction signature", tx)

    const workerData = await program.account.workerData.fetch(workerPDA)
    assert.strictEqual(
      Number(
        workerData.withdrawLimit
      ),
      100
    )
  })

  it("Init Demander", async () => {
    const balance_init = new anchor.BN(100)
    const tx = await program.methods
      .initDemander(balance_init)
      .accounts({
        demander: demander.publicKey,
        demanderData: demanderPDA,
      })
      .signers([demander])
      .rpc()
    console.log("Your transaction signature", tx)

    const demanderData = await program.account.demanderData.fetch(demanderPDA)
    assert.strictEqual(
      Number(
        demanderData.balance
      ),
      100
    )
  })

  it("Token Distribution", async () => {
    const amount = new anchor.BN(50)
    const tx = await program.methods
      .tokenDistribution(amount)
      .accounts({
        worker: worker.publicKey,
        demander: demander.publicKey,
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
      50_000_000_000
    )
  })

  it("worker withdraw", async () => {

    // 初始化一些usdc给deannoUSDCAccount
    const tx_sign = await spl.mintTo(
      connection,
      admin,
      usdcTokenMint,
      deannoUSDCAccount,
      admin,
      100 * 10 ** 6, // 铸造的数量，这里是100个代币，记得乘以10的6次方因为小数位数是6
    );
    console.log(
      `Mint Token Transaction: https://explorer.solana.com/tx/${tx_sign}?cluster=devnet`
    )

    assert.strictEqual(
      Number(
        (await connection.getTokenAccountBalance(deannoUSDCAccount)).value
          .amount
      ),
      100_000_000
    )

    const amount = new anchor.BN(50)
    const tx = await program.methods
      .workerWithdraw(amount)
      .accounts({
        worker: worker.publicKey,
        workerData: workerPDA,
        initData: deannoDataPDA,
        workerTokenAccount: workerTokenAccount,
        workerUsdcAccount: workerUSDCAccount,
        deannoTokenAccount: deannoTokenAccount,
        deannoUsdcAccount: deannoUSDCAccount,
        deannoTokenMint: deannoTokenMintPDA,
        usdcMint: usdcTokenMint
      })
      .signers([worker])
      .rpc()
    console.log("Your transaction signature", tx)

    // Check that 1 token was burned from the player's token account
    assert.strictEqual(
      Number(
        (await connection.getTokenAccountBalance(workerUSDCAccount)).value
          .amount
      ),
      50_000_000_000
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