import { runReadOnlyPreflight } from './parity_check.js';

async function main() {
  const result = await runReadOnlyPreflight();

  if (!result.canProceedToPhaseB) {
    console.error('\n? PHASE A PRE-FLIGHT AUDIT FAILED');
    if (result.validationIssues.length > 0) {
      console.error('\nValidation Issues:');
      result.validationIssues.forEach(v => console.error('  -', v));
    }
    if (result.cardConflicts.length > 0) {
      console.error('\nCard Conflicts:');
      result.cardConflicts.forEach(c => console.error('  -', c));
    }
    if (result.txConflicts.length > 0) {
      console.error('\nTransaction Conflicts:');
      result.txConflicts.forEach(t => console.error('  -', t));
    }
    process.exit(1);
  }

  console.log('\n====================================================');
  console.log('? PHASE A READ-ONLY PRE-FLIGHT AUDIT: 100% PASS');
  console.log('====================================================');
  console.log(`Audited Users: ${result.totalUsersAudited}`);
  console.log(`Legacy Cards: ${result.totalLegacyCards}`);
  console.log(`Legacy Transactions: ${result.totalLegacyTransactions}`);
  console.log(`Cards to Insert: ${result.cardsToInsert.length}`);
  console.log(`Cards Already Verified: ${result.cardsAlreadyVerified.length}`);
  console.log(`Transactions to Insert: ${result.txsToInsert.length}`);
  console.log(`Transactions Already Verified: ${result.txsAlreadyVerified.length}`);
  console.log(`Approved Transformations: ${result.transformationsCount}`);
  console.log(`Conflicts: 0`);
  console.log(`Validation Errors: 0`);
  console.log(`Status: READY FOR PHASE B LIVE BACKFILL (WAITING FOR AUTHORIZATION)`);

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal Preflight Error:', err);
  process.exit(1);
});
