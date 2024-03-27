use anchor_lang::prelude::*;

declare_id!("2ckWV1BszPt6hwfjyLP4FMSrR4zxbYhkXbnJcDWpq4Q7");

#[program]
pub mod de_anno_token_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
