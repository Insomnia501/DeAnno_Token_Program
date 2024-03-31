use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{
        create_metadata_accounts_v3,
        mpl_token_metadata::{accounts::Metadata as MetadataAccount, types::DataV2},
        CreateMetadataAccountsV3, Metadata,
    },
    token::{mint_to, transfer, Mint, MintTo, Transfer, Token, TokenAccount},
};
use solana_program::{pubkey, pubkey::Pubkey};

declare_id!("2ckWV1BszPt6hwfjyLP4FMSrR4zxbYhkXbnJcDWpq4Q7");

const ADMIN_PUBKEY: Pubkey = pubkey!("iSi6TRwqF6RU1R24wY3AWJv9miihmnNUENjEfn3FKTZ");

#[program]
pub mod de_anno_token_program {

    use super::*;

    // Create new token mint with metadata using PDA as mint authority
    pub fn initialize(
        ctx: Context<Initialize>,
        uri: String,
        name: String,
        symbol: String,
        token_price_init: u64,
        withdraw_percent_init: u64
    ) -> Result<()> {
        /*
            初始化：
            1.生成一个tokenMints
            2.初始化tokenPrice,withdraw_percent
         */
        // PDA seeds and bump to "sign" for CPI
        let seeds = b"deanno";
        let bump = ctx.bumps.deanno_token_mint;
        let signer: &[&[&[u8]]] = &[&[seeds, &[bump]]];

        // On-chain token metadata for the mint
        let data_v2 = DataV2 {
            name: name,
            symbol: symbol,
            uri: uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        };

        // CPI Context
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata_account.to_account_info(), // the metadata account being created
                mint: ctx.accounts.deanno_token_mint.to_account_info(), // the mint account of the metadata account
                mint_authority: ctx.accounts.deanno_token_mint.to_account_info(), // the mint authority of the mint account
                update_authority: ctx.accounts.deanno_token_mint.to_account_info(), // the update authority of the metadata account
                payer: ctx.accounts.admin.to_account_info(), // the payer for creating the metadata account
                system_program: ctx.accounts.system_program.to_account_info(), // the system program account, required when creating new accounts
                rent: ctx.accounts.rent.to_account_info(), // the rent sysvar account
            },
            signer, // pda signer
        );

        create_metadata_accounts_v3(
            cpi_ctx, // cpi context
            data_v2, // token metadata
            true,    // is_mutable
            true,    // update_authority_is_signer
            None,    // collection details
        )?;

        ctx.accounts.init_data.token_price = token_price_init; // USDC_amount * token_price = DAN_amount
        ctx.accounts.init_data.withdraw_percent = withdraw_percent_init; //50%

        Ok(())
    }

    // Create new worker account
    pub fn init_worker(ctx: Context<InitWorker>) -> Result<()> {
        // Set initial worker withdraw limit
        ctx.accounts.worker_data.withdraw_limit = 0;
        Ok(())
    }

    // Create new demander account
    pub fn init_demander(ctx: Context<InitDemander>) -> Result<()> {
        // Set initial demander balance
        ctx.accounts.demander_data.balance = 0;
        Ok(())
    }

    // dirtribute token to worker
    pub fn token_distribution(ctx: Context<TokenDistribution>, amount: u64) -> Result<()> {
        /*   
          为worker工作完成后发放对应的token，amount单位为USDC
          减少对应的DemanderBalance，mint对应的DAN并发给worker address
          注意这里的worker address不是通过参数给的，而是通过ctx里面给的
          更新worker withdraw limit
        */
        if ctx.accounts.demander_data.balance < amount {
            return err!(MyError::NotEnoughBalance);
        }

        ctx.accounts.demander_data.balance = ctx.accounts.demander_data.balance.saturating_sub(amount);

        // PDA seeds and bump to "sign" for CPI
        let seeds = b"deanno";
        let bump = ctx.bumps.deanno_token_mint;
        let signer: &[&[&[u8]]] = &[&[seeds, &[bump]]];

        // CPI Context
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.deanno_token_mint.to_account_info(), // mint account of token to mint
                to: ctx.accounts.worker_token_account.to_account_info(), // player token account to mint to
                authority: ctx.accounts.deanno_token_mint.to_account_info(), // pda is used as both address of mint and mint authority
            },
            signer, // pda signer
        );

        // Mint token, accounting for decimals of mint
        let mint_amount = (amount * ctx.accounts.init_data.token_price)
            .checked_mul(10u64.pow(ctx.accounts.deanno_token_mint.decimals as u32))
            .unwrap();

        mint_to(cpi_ctx, mint_amount)?;

        ctx.accounts.worker_data.withdraw_limit = ctx.accounts.worker_data.withdraw_limit.saturating_add(amount * ctx.accounts.init_data.withdraw_percent / 100);

        Ok(())
    }

    // worker withdraw USDC by DAN
    pub fn worker_withdraw(ctx: Context<WorkerWithdraw>, amount: u64) -> Result<()> {
        // worker提现:在withdraw limit内，转DAN给合约，合约转USDC给worker
        let withdraw_amount = amount / ctx.accounts.init_data.token_price;
        if ctx.accounts.worker_data.withdraw_limit < withdraw_amount {
            return err!(MyError::OutOfWithdrawLimit);
        }

        // Transfer DAN
        // PDA seeds and bump to "sign" for CPI
        let seeds = b"deanno";
        let bump = ctx.bumps.deanno_token_mint;
        let signer: &[&[&[u8]]] = &[&[seeds, &[bump]]];

        // CPI Context
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.worker_token_account.to_account_info(), // mint account of token to mint
                to: ctx.accounts.deanno_token_account.to_account_info(), // player token account to mint to
                authority: ctx.accounts.deanno_token_mint.to_account_info(), // pda is used as both address of mint and mint authority
            },
            signer, // pda signer
        );

        // Mint token, accounting for decimals of mint
        let transfer_token_amount = amount
            .checked_mul(10u64.pow(ctx.accounts.deanno_token_mint.decimals as u32))
            .unwrap();

        transfer(cpi_ctx, transfer_token_amount)?;

        // Transfer USDC
        // PDA seeds and bump to "sign" for CPI
        let seeds = b"usdc";//TODO
        let bump = ctx.bumps.usdc_mint;
        let signer: &[&[&[u8]]] = &[&[seeds, &[bump]]];

        // CPI Context
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.deanno_token_account.to_account_info(), // mint account of token to mint
                to: ctx.accounts.worker_token_account.to_account_info(), // player token account to mint to
                authority: ctx.accounts.usdc_mint.to_account_info(), // pda is used as both address of mint and mint authority
            },
            signer, // pda signer
        );

        // Mint token, accounting for decimals of mint
        let transfer_usdc_amount = withdraw_amount
            .checked_mul(10u64.pow(ctx.accounts.deanno_token_mint.decimals as u32))
            .unwrap();

        transfer(cpi_ctx, transfer_usdc_amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    // Use ADMIN_PUBKEY as constraint, only the specified admin can invoke this instruction
    #[account(
        mut,
        address = ADMIN_PUBKEY
    )]
    pub admin: Signer<'info>,

    // The PDA is both the address of the mint account and the mint authority
    #[account(
        init,
        seeds = [b"deanno"],
        bump,
        payer = admin,
        mint::decimals = 9,
        mint::authority = deanno_token_mint,
    )]
    pub deanno_token_mint: Account<'info, Mint>,

    ///CHECK: Using "address" constraint to validate metadata account address, this account is created via CPI in the instruction
    #[account(
        mut,
        address = MetadataAccount::find_pda(&deanno_token_mint.key()).0,
    )]
    pub metadata_account: UncheckedAccount<'info>,

    #[account(
        init,
        seeds = [b"init"],
        bump,
        payer = admin,
        space = 8 + 8 + 8,
    )]
    pub init_data: Account<'info, InitData>,

    pub token_program: Program<'info, Token>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitWorker<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,

    // Initialize worker data account, using worker.key() as a seed allows each worker to create their own account
    #[account(
        init,
        payer = worker,
        space = 8 + 8,
        seeds = [b"worker", worker.key().as_ref()],
        bump,
    )]
    pub worker_data: Account<'info, WorkerData>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitDemander<'info> {
    #[account(mut)]
    pub demander: Signer<'info>,

    // Initialize demander data account, using demander.key() as a seed allows each demander to create their own account
    #[account(
        init,
        payer = demander,
        space = 8 + 8,
        seeds = [b"demander", demander.key().as_ref()],
        bump,
    )]
    pub demander_data: Account<'info, DemanderData>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TokenDistribution<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub worker: Signer<'info>,//TODO:这里感觉不应该增加worker这个signer
    pub demander: Signer<'info>,

    #[account(
        mut,
        seeds = [b"demander", demander.key().as_ref()],
        bump,
    )]
    pub demander_data: Account<'info, DemanderData>,

    #[account(
        mut,
        seeds = [b"worker", worker.key().as_ref()],
        bump,
    )]
    pub worker_data: Account<'info, WorkerData>,

    #[account(
        mut,
        seeds = [b"init"],
        bump,
    )]
    pub init_data: Account<'info, InitData>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = deanno_token_mint,
        associated_token::authority = worker
    )]
    pub worker_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"deanno"],
        bump,
    )]
    pub deanno_token_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WorkerWithdraw<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"worker", worker.key().as_ref()],
        bump,
    )]
    pub worker_data: Account<'info, WorkerData>,

    #[account(
        mut,
        seeds = [b"init"],
        bump,
    )]
    pub init_data: Account<'info, InitData>,

    #[account(
        init_if_needed,
        payer = worker,
        associated_token::mint = deanno_token_mint,
        associated_token::authority = worker
    )]
    pub worker_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = worker,
        associated_token::mint = usdc_mint,
        associated_token::authority = worker
    )]
    pub worker_usdc_account: Account<'info, TokenAccount>,

    //合约本身的token账户
    #[account(
        init_if_needed,
        payer = worker,
        associated_token::mint = deanno_token_mint,
        associated_token::authority = init_data
    )]
    pub deanno_token_account: Account<'info, TokenAccount>,

    //合约本身的usdc账户
    #[account(
        init_if_needed,
        payer = worker,
        associated_token::mint = usdc_mint,
        associated_token::authority = init_data
    )]
    pub deanno_usdc_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"deanno"],
        bump,
    )]
    pub deanno_token_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"usdc"],//TODO
        bump,
    )]
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct InitData {
    pub token_price: u64,
    pub withdraw_percent: u64
}

#[account]
pub struct WorkerData {
    pub withdraw_limit: u64,
}

#[account]
pub struct DemanderData {
    pub balance: u64,
}

#[error_code]
pub enum MyError {
    #[msg("Not enough health")]
    NotEnoughBalance,
    #[msg("Out of withdraw limit")]
    OutOfWithdrawLimit,
}
