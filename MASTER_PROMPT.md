<USER_REQUEST>
# MASTER PROMPT — COMPLETE SEPARATION OF USER DATA, TELEGRAM, CHAT, FILES, PREMIUM & ADMIN LOGIC

## 0. CORE OBJECTIVE

The current system has become too mixed together.

Telegram bot behavior, user accounts, Telegram messages, chat history, file receiving, account deletion/wiping, premium access, daily query limits, and the Admin Users tab appear to share logic that should be independent.

This is causing bugs where changing/deleting/wiping something in one area unexpectedly affects another area.

Examples of the current problem:

* Telegram bot "wipe data" does not behave consistently for every user.
* Wiping/deleting data can affect message visibility or message handling.
* Messages in Telegram bot behavior and admin-side user management appear to be coupled.
* User files and chat/message management are mixed together.
* Admin Users actions are connected to unrelated Telegram functionality.
* Different types of user data are not clearly separated.
* A fix in one system can accidentally break another system.

DO NOT continue patching this architecture with small conditional fixes.

The goal is to make the system:

> MODULAR, SEPARATE, PREDICTABLE, AUDITABLE, AND EASY TO UNDERSTAND.

Every major responsibility must have its own clearly defined logic.

---

# 1. VERY IMPORTANT ARCHITECTURAL RULE

Treat the following as SEPARATE SYSTEMS:

1. User Account
2. User Financial Data
3. User Telegram Identity
4. Telegram Bot Messaging
5. Telegram Message History
6. User File Receiving
7. Premium / Subscription
8. Daily Query Usage
9. Admin User Management
10. Admin Audit Logs

These systems may have relationships with each other through IDs/references, but they must NOT share destructive logic unnecessarily.

For example:

Deleting a user's financial data must NOT automatically mean:

* delete Telegram message handling
* delete Telegram bot identity
* disable file receiving
* delete premium state
* reset unrelated systems
* remove the Telegram user
* break future bot messages

Likewise:

Deleting Telegram message history must NOT mean:

* delete financial entries
* delete the account
* remove premium
* block the user
* delete uploaded files
* reset daily queries

Every operation must have a clearly defined scope.

---

# 2. FIRST: AUDIT THE CURRENT ARCHITECTURE

Before changing functionality, inspect the entire project.

Do NOT immediately start editing.

Identify:

### User/account logic

* user creation
* user deletion
* user blocking
* authentication
* Telegram user identification
* profile data

### Financial data

* entries
* entry history
* categories
* balances
* financial records
* AI analysis data

### Telegram

* webhook
* bot handlers
* commands
* callback handlers
* Telegram user ID
* incoming messages
* outgoing messages
* Telegram file/document/photo handling

### Messages

* message storage
* conversation history
* message deletion
* chat history
* AI conversation context

### Files

* file receiving
* Telegram document/photo processing
* file storage
* file metadata
* file references

### Premium

* premium status
* premium expiration
* subscription state

### Queries

* daily query counter
* request usage
* quota reset

### Admin

* Users tab
* user actions
* admin permissions
* audit logs

Create a dependency map before refactoring.

Find every place where one module directly modifies another module's data.

---

# 3. USER ACCOUNT MUST BE ITS OWN SYSTEM

Create a clear User Account layer.

It should be responsible for:

* user identity
* account status
* blocked/unblocked state
* basic profile
* account creation
* account deletion

It should NOT directly contain:

* chat deletion logic
* message logic
* file logic
* premium calculation
* AI query counting
* financial deletion implementation

Those systems should expose their own operations.

---

# 4. FINANCIAL DATA MUST BE SEPARATE

Financial records must have their own deletion/wiping logic.

Examples:

* income entries
* expense entries
* entry history
* financial categories
* financial analysis-related stored data

Create a clear operation such as:

`wipeFinancialData(userId)`

This operation must ONLY affect financial/user-data records that are explicitly defined as financial data.

It must NOT:

* delete Telegram identity
* delete Telegram messages
* delete bot access
* delete files
* delete premium
* block user
* reset daily queries

Unless a specific data policy explicitly says otherwise.

---

# 5. TELEGRAM IDENTITY MUST BE SEPARATE

A Telegram user identity is not the same thing as the user's application data.

Keep Telegram identity information independently understandable.

For example:

* internal user ID
* Telegram user ID
* Telegram username
* Telegram metadata required for bot communication

The system must know:

> "This application user is associated with this Telegram account."

But deleting application data must not accidentally destroy the information required for future Telegram interaction unless the operation explicitly requests that.

---

# 6. TELEGRAM BOT MUST BE ITS OWN SYSTEM

The Telegram bot should have its own service/module.

Its responsibility:

* receive Telegram updates
* identify the user
* process commands
* process callbacks
* send responses
* receive supported files
* trigger application services

The Telegram bot should NOT contain the implementation of:

* database wiping
* financial deletion
* premium management
* quota management
* account deletion

Instead, it should CALL separate services.

For example:

```text
Telegram Command
      ↓
Telegram Handler
      ↓
Specific Application Service
      ↓
Database
```

NOT:

```text
Telegram Handler
      ↓
random database deletions
      ↓
other Telegram tables
      ↓
user tables
      ↓
financial tables
      ↓
everything mixed together
```

---

# 7. TELEGRAM WIPE DATA MUST BE A SEPARATE OPERATION

Create a clearly isolated operation for the Telegram bot's "wipe data" functionality.

For example:

`wipeUserDataFromTelegram(userId)`

But do NOT assume what this should delete.

First define exactly which data categories the Telegram "wipe data" command is supposed to remove.

The implementation must have an explicit deletion matrix.

Example:

| Data category               | Telegram Wipe               |
| --------------------------- | --------------------------- |
| Financial entries           | YES                         |
| Entry history               | YES                         |
| AI-related stored user data | according to defined policy |
| Telegram identity           | NO                          |
| Telegram bot access         | NO                          |
| Premium                     | NO                          |
| Block status                | NO                          |
| Daily query configuration   | NO                          |
| Uploaded files              | explicitly defined          |
| Telegram message history    | explicitly defined          |

Do not allow a generic:

```text
deleteUser(userId)
```

to perform all of this.

A "wipe data" operation must call only the specific services it is supposed to call.

---

# 8. ADMIN ACCOUNT WIPE MUST BE SEPARATE FROM TELEGRAM WIPE

The Admin Users tab's "Wipe Data" action must NOT reuse a vague generic user deletion function.

Create a separate admin-level operation:

`adminWipeUserData(userId)`

It can internally call the appropriate data-specific services, but the scope must be explicit.

The Admin Users tab must know exactly what:

> Wipe Data

means.

Do not make the Admin button secretly execute the same operation as:

* Telegram `/delete`
* Telegram `/reset`
* account deletion
* chat deletion

unless that is intentionally defined.

---

# 9. ACCOUNT DELETION IS DIFFERENT FROM DATA WIPING

These are NOT the same operation.

### WIPE DATA

Removes the selected user data while preserving the account/identity where appropriate.

### DELETE ACCOUNT

Removes the actual account according to the application's account-deletion policy.

### BLOCK USER

Changes access/status.

These three operations must have separate service functions.

For example:

```text
wipeUserData(userId)

deleteUserAccount(userId)

blockUser(userId)
```

Never create one giant function such as:

```text
deleteEverything(userId)
```

and reuse it everywhere.

---

# 10. TELEGRAM MESSAGES MUST BE SEPARATE

Telegram messages are their own data category.

If message history is stored in the application database, define it separately.

For example:

```text
telegram_messages
```

or whatever structure already exists.

Message deletion must be a dedicated operation:

```text
deleteTelegramMessageHistory(userId)
```

This operation must NOT delete:

* financial records
* account
* premium
* files
* quota
* Telegram identity

unless explicitly required.

---

# 11. IMPORTANT: DO NOT BREAK TELEGRAM MESSAGE RECEIVING

We are NOT trying to remove Telegram messaging from the bot.

The bot must continue to:

* receive user messages
* process commands
* receive supported content
* respond to users

The problem is the architecture and admin management of those messages.

Do not confuse:

### REMOVE

Admin-side chat/message management from the Users tab.

### KEEP

Normal Telegram bot message receiving and processing.

---

# 12. FILE RECEIVING MUST REMAIN FULLY FUNCTIONAL

This is extremely important.

The application currently supports receiving files from users through Telegram.

DO NOT remove this.

Do NOT remove:

* Telegram document receiving
* photo receiving
* file download handling
* file processing
* file storage
* file metadata handling
* whatever functionality is required for the existing user file workflow

We are only removing unnecessary ADMIN-SIDE chat/message management.

The following are different:

```text
User sends file to Telegram bot
            ↓
Bot receives file
            ↓
System processes file
```

KEEP THIS.

Versus:

```text
Admin opens Users tab
            ↓
Admin views/manages user's chat
```

REMOVE THIS.

---

# 13. FILE DATA MUST ALSO HAVE A CLEAR BOUNDARY

File receiving should have its own service/module.

For example:

```text
TelegramFileReceiver
FileStorageService
FileProcessingService
```

The file-receiving service should not depend on the Admin Users chat interface.

Therefore:

Removing the Users-tab chat UI must NOT break file receiving.

---

# 14. PREMIUM MUST BE COMPLETELY SEPARATE

Premium is an access/subscription system.

It should be responsible for:

* premium status
* expiration date
* checking whether premium is active
* granting full premium

It should NOT be part of:

* message deletion
* financial wiping
* Telegram message deletion
* account blocking
* daily query reset

Admin action:

### Give Full Premium

Flow:

```text
Give Full Premium
       ↓
Select expiration date
       ↓
Confirm
       ↓
Save premium expiration
```

Nothing more.

No complicated premium configuration.

---

# 15. DAILY QUERY USAGE MUST BE SEPARATE

Daily query usage is its own system.

For example:

```text
daily_query_usage
```

or the existing equivalent.

Admin needs only:

### Reset Daily Queries

This operation should ONLY reset the daily usage counter.

For example:

```text
resetDailyQueries(userId)
```

It must NOT:

* wipe financial data
* delete messages
* remove premium
* unblock/block user
* delete files
* delete the account

---

# 16. BLOCKING MUST BE SEPARATE

Blocking is an account-access operation.

Example:

```text
blockUser(userId)
unblockUser(userId)
```

Blocking should not:

* wipe data
* delete messages
* remove premium
* reset queries
* delete files

Unless a separate security policy explicitly requires something.

---

# 17. ADMIN USERS TAB — FINAL SIMPLIFICATION

The Users tab should NOT be a chat-management interface.

REMOVE:

* Chat viewer
* Message viewer
* Message deletion
* Chat deletion
* Message counters
* Chat previews
* Admin messaging
* User conversation management
* Message-related controls

Remove the actual implementation/code, not only the UI.

Search the codebase for the removed functionality and clean up:

* components
* hooks
* API routes
* server actions
* database queries
* types
* imports
* state
* handlers
* services
* admin chat logic

Do not delete code that is required by the Telegram bot's normal message receiving.

---

# 18. FINAL USERS TAB

The Users tab should contain only:

### User information

Basic information necessary for administration.

### Delete / Wipe

Clearly separated destructive actions.

### Block / Unblock

Account access control.

### Give Full Premium

Choose expiration date → grant full premium.

### Reset Daily Queries

Reset the daily usage counter.

That's it.

No chat management.

No message management.

No complicated quota management.

No individual premium feature toggles.

---

# 19. USE SERVICE-BASED OPERATIONS

Create clear service boundaries.

Conceptually:

```text
UserService
FinancialDataService
TelegramIdentityService
TelegramBotService
TelegramMessageService
TelegramFileService
PremiumService
QueryUsageService
AdminUserService
AuditLogService
```

Exact naming can follow the project's existing architecture.

The important requirement is separation of responsibility.

---

# 20. NO CROSS-SYSTEM "MAGIC DELETE"

NEVER use broad deletion logic such as:

```text
delete user
→ cascade everything
```

without explicitly understanding the consequences.

Database cascade relationships must be audited carefully.

If cascading deletion is used, document exactly what it deletes.

A database foreign-key cascade must never accidentally cause:

```text
delete financial data
→ delete Telegram identity
→ delete messages
→ delete files
→ delete premium
→ delete account
```

unless this is intentionally designed.

---

# 21. TRANSACTION SAFETY

Where multiple data categories are intentionally wiped together, use a proper transaction where appropriate.

For example:

```text
Admin Wipe Data
    ↓
BEGIN
    ↓
FinancialDataService.wipe()
    ↓
AIDataService.wipe()
    ↓
other explicitly selected data
    ↓
COMMIT
```

If the operation fails:

```text
ROLLBACK
```

Do not leave the user in a half-wiped state.

However, do not put unrelated systems into the same transaction simply because they are all associated with the same user.

---

# 22. IDENTIFY USER BY STABLE ID

Do not randomly mix:

* Telegram user ID
* database user ID
* username
* phone number
* message ID

Use the internal database user ID as the primary application reference where possible.

Telegram handlers should resolve:

```text
Telegram ID
    ↓
Internal User ID
    ↓
Specific service
```

This should prevent operations from accidentally targeting the wrong user.

---

# 23. MULTI-USER SAFETY

This is especially important because the current wiping issue appears to behave inconsistently across users.

Every operation must be scoped to the correct `userId`.

Audit for:

* global variables
* cached user IDs
* shared state
* singleton state containing user-specific information
* incorrect query filters
* missing `WHERE user_id = ...`
* reused Telegram context
* incorrectly cached database responses
* race conditions
* webhook concurrency problems
* hardcoded user IDs
* admin operations without user scoping

A wipe for User A must NEVER affect User B.

Test this explicitly.

---

# 24. TELEGRAM WEBHOOK / CONCURRENCY AUDIT

Because multiple Telegram users can interact with the bot simultaneously, inspect the Telegram webhook/update processing.

Make sure user-specific state is not stored in a global mutable variable.

BAD:

```text
currentUser = ...
```

GOOD:

```text
handleUpdate(update) {
    const userId = resolveUser(update)
    ...
}
```

Every update must independently resolve its user.

Two users sending messages at the same time must not interfere with each other.

---

# 25. DATA OWNERSHIP MATRIX

Create a clear internal ownership table before finishing the refactor.

Example:

| System                  | Owns                | Can modify              |
| ----------------------- | ------------------- | ----------------------- |
| UserService             | Account             | Account                 |
| FinancialDataService    | Financial records   | Financial records       |
| TelegramIdentityService | Telegram identity   | Telegram identity       |
| TelegramMessageService  | Messages            | Messages                |
| TelegramFileService     | Files               | Files                   |
| PremiumService          | Premium             | Premium                 |
| QueryUsageService       | Daily usage         | Daily usage             |
| AdminUserService        | Admin orchestration | Calls specific services |
| AuditLogService         | Admin audit logs    | Audit logs              |

The key rule:

> A service should modify its own domain, not randomly modify another domain's tables.

---

# 26. ADMIN ACTION AUDIT LOG

Every destructive/admin-sensitive action should be logged.

At minimum:

* admin user ID
* target user ID
* action type
* timestamp
* result
* relevant before/after information where appropriate

Examples:

```text
USER_DATA_WIPED
ACCOUNT_DELETED
USER_BLOCKED
USER_UNBLOCKED
FULL_PREMIUM_GRANTED
DAILY_QUERIES_RESET
```

Do not log sensitive content unnecessarily.

---

# 27. TEST THE SYSTEM AS SEPARATE SCENARIOS

After refactoring, test at least these scenarios.

### TEST 1 — User A financial wipe

User A's financial data disappears.

User B's financial data remains.

Telegram identity remains.

Premium remains.

Daily query state remains.

File receiving remains functional.

---

### TEST 2 — User B financial wipe

Exactly the same behavior, but only for User B.

Verify User A remains untouched.

---

### TEST 3 — Telegram bot wipe

Trigger the Telegram wipe for User A.

Verify the exact defined data categories are removed.

Verify User B remains untouched.

Verify future Telegram messages can still be received if Telegram identity/account access is supposed to remain.

---

### TEST 4 — Message deletion

Delete message history.

Verify financial data remains.

Verify premium remains.

Verify account remains.

Verify file receiving remains.

---

### TEST 5 — File receiving

Send a supported file through Telegram.

Verify:

* Telegram receives it
* application receives it
* processing still works
* storage still works

Even though Users-tab chat management has been removed.

---

### TEST 6 — Premium

Give User A Full Premium until a selected date.

Verify:

* premium is active
* expiration is stored correctly
* User B is unaffected

---

### TEST 7 — Daily query reset

Reset User A's daily queries.

Verify:

* only User A's usage resets
* premium is unchanged
* financial data is unchanged
* messages are unchanged

---

### TEST 8 — Block

Block User A.

Verify the actual access restriction works.

Verify:

* financial data remains
* messages are not randomly deleted
* files are not randomly deleted
* premium is not accidentally removed

---

# 28. DO NOT "FIX" THIS BY HIDING UI

This is a strict requirement.

If we remove a feature, remove it from the implementation.

Do NOT do:

```css
display: none;
```

or:

```text
button removed but API remains
```

or:

```text
UI hidden but backend still contains unused chat-management logic
```

Instead:

* remove UI
* remove handlers
* remove API
* remove service
* remove database queries if no longer needed
* remove types
* remove imports
* remove state
* remove dead code

BUT preserve shared functionality that is still required by the Telegram bot.

---

# 29. DO NOT OVER-REFACTOR

Do not rewrite the entire application unnecessarily.

First understand the existing code.

Then separate responsibilities with the smallest safe architectural changes.

Preserve:

* current working financial functionality
* Telegram bot
* Telegram file receiving
* existing AI behavior
* premium behavior unless being simplified
* existing database where possible

The goal is:

> CLEAN SEPARATION, NOT A COMPLETELY NEW APPLICATION.

---

# 30. FINAL CODEBASE AUDIT

After implementation, search the entire codebase for:

* chat
* messages
* message deletion
* conversation
* wipe
* delete user
* Telegram webhook
* Telegram update
* file receiving
* premium
* query reset
* block
* user deletion
* cascade
* user_id
* telegram_id

Look for accidental dependencies between modules.

For every destructive operation, answer:

1. What exact data does it modify?
2. What exact user does it target?
3. Can it affect another user?
4. Can it affect Telegram?
5. Can it affect financial data?
6. Can it affect files?
7. Can it affect premium?
8. Can it affect query usage?
9. Is the operation transactional where necessary?
10. Is it logged?

If any answer is unclear, fix the architecture before considering the task complete.

---

# 31. FINAL ACCEPTANCE CRITERIA

The task is complete ONLY when:

* Telegram bot works normally.
* Telegram messages can still be received.
* Telegram files can still be received.
* File processing/storage still works.
* Telegram wipe works consistently for every individual user.
* User A's wipe cannot affect User B.
* Admin wipe is clearly separated from Telegram wipe.
* Account deletion is separate from data wiping.
* Blocking is separate from deletion.
* Premium is separate from deletion.
* Daily query reset is separate from deletion.
* Message deletion is separate from financial deletion.
* Users-tab chat/message management is completely removed.
* Unnecessary Users-tab code is actually removed.
* No hidden/dead chat-management functionality remains.
* No global user-specific state causes cross-user bugs.
* Database queries are correctly scoped by user ID.
* Cascading deletes have been audited.
* Admin actions are auditable.
* TypeScript/build/lint errors are resolved.
* Existing unrelated functionality is not broken.

## MOST IMPORTANT PRINCIPLE

Do not think of the application as:

```text
USER
 ├── everything
 ├── everything else
 └── everything else
```

Think of it as:

```text
                    ┌── Financial Data
                    │
                    ├── Telegram Identity
                    │
                    ├── Telegram Messages
                    │
USER ────────────────┼── Telegram Files
                    │
                    ├── Premium
                    │
                    ├── Daily Query Usage
                    │
                    └── Account / Access
```

Each domain has its own logic.

The Admin panel and Telegram bot are CLIENTS/ENTRY POINTS that call these domain services.

They should NOT contain tangled copies of the same deletion logic.

The final architecture must make it immediately understandable:

> "If I want to wipe financial data, I know exactly which service does it."

> "If I want to delete Telegram messages, I know exactly which service does it."

> "If I want to receive a Telegram file, I know exactly which service handles it."
Verify:

* only User A's usage resets
* premium is unchanged
* financial data is unchanged
* messages are unchanged

---

### TEST 8 — Block

Block User A.

Verify the actual access restriction works.

Verify:

* financial data remains
* messages are not randomly deleted
* files are not randomly deleted
* premium is not accidentally removed

---

# 28. DO NOT "FIX" THIS BY HIDING UI

This is a strict requirement.

If we remove a feature, remove it from the implementation.

Do NOT do:

```css
display: none;
```

or:

```text
button removed but API remains
```

or:

```text
UI hidden but backend still contains unused chat-management logic
```

Instead:

* remove UI
* remove handlers
* remove API
* remove service
* remove database queries if no longer needed
* remove types
* remove imports
* remove state
* remove dead code

BUT preserve shared functionality that is still required by the Telegram bot.

---

# 29. DO NOT OVER-REFACTOR

Do not rewrite the entire application unnecessarily.

First understand the existing code.

Then separate responsibilities with the smallest safe architectural changes.

Preserve:

* current working financial functionality
* Telegram bot
* Telegram file receiving
* existing AI behavior
* premium behavior unless being simplified
* existing database where possible

The goal is:

> CLEAN SEPARATION, NOT A COMPLETELY NEW APPLICATION.

---

# 30. FINAL CODEBASE AUDIT

After implementation, search the entire codebase for:

* chat
* messages
* message deletion
* conversation
* wipe
* delete user
* Telegram webhook
* Telegram update
* file receiving
* premium
* query reset
* block
* user deletion
* cascade
* user_id
* telegram_id

Look for accidental dependencies between modules.

For every destructive operation, answer:

1. What exact data does it modify?
2. What exact user does it target?
3. Can it affect another user?
4. Can it affect Telegram?
5. Can it affect financial data?
6. Can it affect files?
7. Can it affect premium?
8. Can it affect query usage?
9. Is the operation transactional where necessary?
10. Is it logged?

If any answer is unclear, fix the architecture before considering the task complete.

---

# 31. FINAL ACCEPTANCE CRITERIA

The task is complete ONLY when:

* Telegram bot works normally.
* Telegram messages can still be received.
* Telegram files can still be received.
* File processing/storage still works.
* Telegram wipe works consistently for every individual user.
* User A's wipe cannot affect User B.
* Admin wipe is clearly separated from Telegram wipe.
* Account deletion is separate from data wiping.
* Blocking is separate from deletion.
* Premium is separate from deletion.
* Daily query reset is separate from deletion.
* Message deletion is separate from financial deletion.
* Users-tab chat/message management is completely removed.
* Unnecessary Users-tab code is actually removed.
* No hidden/dead chat-management functionality remains.
* No global user-specific state causes cross-user bugs.
* Database queries are correctly scoped by user ID.
* Cascading deletes have been audited.
* Admin actions are auditable.
* TypeScript/build/lint errors are resolved.
* Existing unrelated functionality is not broken.

## MOST IMPORTANT PRINCIPLE

Do not think of the application as:

```text
USER
 ├── everything
 ├── everything else
 └── everything else
```

Think of it as:

```text
                    ┌── Financial Data
                    │
                    ├── Telegram Identity
                    │
                    ├── Telegram Messages
                    │
USER ────────────────┼── Telegram Files
                    │
                    ├── Premium
                    │
                    ├── Daily Query Usage
                    │
                    └── Account / Access
```

Each domain has its own logic.

The Admin panel and Telegram bot are CLIENTS/ENTRY POINTS that call these domain services.

They should NOT contain tangled copies of the same deletion logic.

The final architecture must make it immediately understandable:

> "If I want to wipe financial data, I know exactly which service does it."

> "If I want to delete Telegram messages, I know exactly which service does it."

> "If I want to receive a Telegram file, I know exactly which service handles it."

> "If I want to give premium, I know exactly which service handles it."

> "If I want to reset queries, I know exactly which service handles it."

> "If I want to delete an account, I know exactly which service handles it."

No operation should unexpectedly perform another operation.

DO NOT declare this complete until the architecture and actual code reflect this separation.

---

# 32. MINI APP — PREMIUM DISPLAY MUST USE DAYS

There is another important UX issue in the Mini App.

Currently, premium remaining time is being displayed as a countdown using:
- seconds
- minutes
- hours
- or a live timer/counter

This is NOT appropriate for our premium system.

Premium is granted in DAYS.

The Mini App should therefore communicate premium duration in DAYS, not seconds or minutes.

## PREMIUM DISPLAY RULE

If a user has Full Premium, show something simple such as:

Full Premium
12 days remaining

or:

Full Premium
Expires in 12 days

Do NOT show:

- 1,036,800 seconds
- 17,280 minutes
- 288 hours
- live second-by-second countdown
- unnecessary countdown animations

The user does not need to see technical time precision.

---

# 33. PREMIUM CALCULATION

The backend/database may continue storing an exact expiration timestamp/date when technically necessary.

However, the presentation layer must convert that value into a human-friendly number of DAYS.

For example:

```text
premium_expires_at = exact timestamp
```

Display:

```text
12 days remaining
```

NOT:

```text
1036800 seconds remaining
```

Use a consistent day calculation across the Mini App.

Do not create different premium calculations in different components.

Create/use one shared premium-status calculation so that:

* Profile
* Premium section
* other relevant screens

all show the same status.

---

# 34. PREMIUM EXPIRATION DISPLAY

Use simple human-readable states.

### Active premium

```text
Full Premium
12 days remaining
```

### One day remaining

```text
Full Premium
1 day remaining
```

Do not write:

```text
23 hours 41 minutes
```

### Expired

```text
Premium expired
```

Do not show negative days.

Do not show:

```text
-534 minutes
```

### No premium

```text
Free plan
```

Use the application's existing language/localization style.

---

# 35. REMOVE PREMIUM COUNTER FROM THE MAIN MENU

The current Mini App main menu has a premium button/section that displays the remaining premium counter.

Remove the remaining-time counter from the MAIN MENU.

The main menu should NOT constantly display:

* seconds remaining
* minutes remaining
* hours remaining
* days remaining
* countdown timer

The Premium button/menu item can remain if it is part of the navigation, but it should NOT contain a live countdown/counter.

Keep the main menu clean and simple.

---

# 36. PREMIUM INFORMATION BELONGS IN PROFILE

Move the detailed premium status into the user's PROFILE section.

The Profile should be the primary place where the user can see their premium status.

For example:

```text
PROFILE

Name
Telegram account

Subscription
Full Premium

12 days remaining
Expires: 24 September 2026
```

Keep this clean and understandable.

The important information is:

* Current plan
* Premium status
* Remaining days
* Expiration date

Do not clutter the profile with technical subscription information.

---

# 37. DO NOT CREATE A SECOND PREMIUM SYSTEM

Do not implement a separate Mini App premium countdown system.

The Mini App must read the actual premium information from the existing backend/database.

There must be ONE source of truth for:

```text
premium status
premium expiration
```

The Mini App only formats/displays it.

Do NOT use:

* localStorage as the authoritative premium state
* a frontend-only countdown as the source of truth
* hardcoded premium duration
* separate frontend expiration state
* duplicate premium calculations

The backend remains authoritative.

---

# 38. IMPORTANT: FRONTEND COUNTDOWN CODE CLEANUP

Do not simply hide the existing countdown.

If the existing Mini App contains code specifically responsible for displaying the premium counter in seconds/minutes, remove that unnecessary presentation logic.

Search for:

* countdown timers
* setInterval
* setTimeout
* seconds remaining
* minutes remaining
* live premium timer
* premium countdown components
* premium timer hooks
* unnecessary polling used only for the countdown

Remove them where they are no longer required.

BUT do not remove backend expiration validation.

The backend still needs to determine whether premium is active.

---

# 39. PREMIUM BUTTON / MAIN MENU

The Premium button in the main menu should be simple.

Example:

```text
⭐ Premium
```

or the existing appropriate design.

It should NOT say:

```text
⭐ Premium — 12:34:52
```

and should NOT dynamically update every second.

The user can open Profile to see:

```text
Full Premium
12 days remaining
```

---

# 40. PREMIUM UX PRINCIPLE

Premium is a subscription measured in DAYS.

Therefore:

```text
ADMIN
Give Full Premium
        ↓
Select expiration date
        ↓
Backend stores expiration
        ↓
Mini App
        ↓
Profile
        ↓
"12 days remaining"
```

NOT:

```text
Admin gives premium
        ↓
Mini App starts second counter
        ↓
Main menu constantly updates
```

The first approach is the required architecture.

---

# 41. FINAL MINI APP PREMIUM REQUIREMENTS

After this change:

* Premium duration is understood as days.
* Profile shows remaining premium days.
* Profile can show the expiration date.
* Main menu does NOT show a premium countdown.
* Premium button does NOT show seconds/minutes.
* No second-by-second premium timer is needed.
* Backend remains the single source of truth.
* Premium expiration is validated server-side.
* Expired premium is displayed cleanly.
* No negative countdown is shown.
* No duplicate premium systems are created.
* Existing unrelated Mini App functionality must continue working.

Do NOT merely hide the existing counter.

Remove the unnecessary countdown implementation and replace it with a simple, shared, day-based premium-status display in Profile.