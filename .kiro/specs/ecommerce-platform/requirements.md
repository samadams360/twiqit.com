# Requirements Document

## Introduction

Twiqit Alpha is a single-item e-commerce platform inspired by the Woot model, where only one item is offered for sale at a time. Users participate by purchasing and bidding with Twiqs, a virtual currency. A raffle mechanic determines the winner, managed exclusively by the site administrator. The platform prioritizes security, performance, and a clean user experience even when no active raffle exists.

## Glossary

- **System**: The Twiqit web application
- **User**: A registered and authenticated member of the platform
- **Admin**: The site administrator with elevated privileges
- **Twiq**: The virtual currency used to purchase bids and participate in raffles
- **Raffle**: A timed, Twiq-based bidding event for the single featured item
- **Drop**: The featured item currently available for raffle participation
- **Winner_Selector**: The component responsible for randomly selecting a raffle winner
- **Auth_Service**: The component handling user registration, sign-in, and session management
- **Preference_Service**: The component handling user profile and preference updates
- **DB_Server**: The database server storing application and user data
- **Web_Server**: The application/web server serving the Twiqit frontend and API

---

## Requirements

### Requirement 1: Single Active Item (Featured Drop)

**User Story:** As a user, I want to see one featured item at a time, so that the shopping experience is focused and simple.

#### Acceptance Criteria

1. THE System SHALL display at most one active Drop at any given time.
2. WHEN no active Raffle exists, THE System SHALL display a pleasant placeholder state indicating no item is currently available.
3. WHEN an active Raffle exists, THE System SHALL display the featured item's details prominently on the homepage.

---

### Requirement 2: Twiq Currency — Earning and Cash Out

**User Story:** As a user, I want to earn Twiqs by completing actions on the site and cash them out, so that I can participate in raffles and retrieve my balance.

#### Acceptance Criteria

1. THE System SHALL support earning Twiqs by completing qualifying actions, with watching an ad being the initial qualifying action.
2. WHEN a User watches an ad, THE System SHALL credit 100 Twiqs to the User's balance.
3. THE System SHALL enforce a limit of one ad watch per User per 24-hour period.
4. IF a User attempts to watch an ad within 24 hours of their last qualifying action, THEN THE System SHALL reject the credit and notify the User of the time remaining before they are eligible again.
5. THE qualifying action mechanism SHALL be designed to support additional action types in future iterations without requiring structural changes.
6. WHEN a User initiates a cash-out request, THE System SHALL process the withdrawal against the User's stored bank account information.
7. IF a cash-out request fails, THEN THE System SHALL notify the User with a descriptive error message and leave the User's balance unchanged.

---

### Requirement 3: Raffle Bidding

**User Story:** As a user, I want to bid Twiqs on the active Raffle, so that I can enter for a chance to win the featured item.

#### Acceptance Criteria

1. WHEN a User submits a bid on an active Raffle, THE System SHALL deduct the bid amount in Twiqs from the User's balance and record the bid entry.
2. IF a User's Twiq balance is insufficient to cover the bid amount, THEN THE System SHALL reject the bid and notify the User.
3. WHILE a Raffle is active, THE System SHALL accept bids from authenticated Users.
4. WHEN a Raffle is no longer active, THE System SHALL reject any further bid submissions.
5. THE System SHALL display the current total Twiqs bid, the minimum Twiq threshold, and the maximum Twiq threshold for the active Raffle on the homepage, with a visual progress indicator showing how close the Raffle is to each threshold.
6. WHEN a User views an active Raffle, THE System SHALL display the total number of Twiqs that User has personally bid on that Raffle.

---

### Requirement 4: Admin-Only Raffle Management

**User Story:** As an admin, I want exclusive control to create, update, and replace the active Raffle, so that I can manage the platform's featured drops.

#### Acceptance Criteria

1. THE System SHALL restrict Raffle creation, update, and replacement operations to Admin users only.
2. WHEN an Admin creates a Raffle, THE System SHALL require the Admin to specify a minimum Twiq threshold, a maximum Twiq threshold, and an expiration time.
3. WHEN an Admin updates an active Raffle, THE System SHALL apply the changes and preserve all existing bid entries.
4. WHEN an Admin replaces the active Raffle, THE System SHALL close the current Raffle and create the new one.
5. IF a non-Admin User attempts a Raffle management operation, THEN THE System SHALL deny the request and return an authorization error.

---

### Requirement 5: Raffle Expiration Logic

**User Story:** As an admin, I want the Raffle to expire automatically based on thresholds or time, so that the platform operates without manual intervention.

#### Acceptance Criteria

1. WHEN the total Twiqs bid on a Raffle reaches the maximum Twiq threshold, THE System SHALL immediately close the Raffle and trigger winner selection.
2. WHEN the Raffle expiration time is reached, THE System SHALL close the Raffle and trigger winner selection, regardless of the current Twiq total.
3. WHILE a Raffle's total Twiqs bid is below the minimum Twiq threshold at expiration time, THE System SHALL close the Raffle without selecting a winner and notify the Admin.

---

### Requirement 6: Winner Selection

**User Story:** As a user, I want the winner to be chosen fairly and randomly, so that every bid has an equal chance of winning.

#### Acceptance Criteria

1. WHEN a Raffle closes with sufficient participation, THE Winner_Selector SHALL randomly determine the winning bid entry.
2. THE Winner_Selector SHALL be implemented as a loosely coupled, replaceable component so that the randomization algorithm can be swapped without modifying other system components.
3. THE System SHALL record the selected winner and associate the win with the corresponding Raffle.

---

### Requirement 7: Winner Notification and Receipt Confirmation

**User Story:** As a winner, I want to be notified by email and confirm receipt of my item, so that the transaction is acknowledged end-to-end.

#### Acceptance Criteria

1. WHEN a winner is selected, THE System SHALL send an email notification to the winning User's registered email address.
2. WHEN a winning User confirms receipt of the item, THE System SHALL record the confirmation and update the Raffle's status accordingly.
3. THE System SHALL provide the winning User with a mechanism to confirm receipt of the item.

---

### Requirement 8: User Authentication and Preferences

**User Story:** As a visitor, I want to sign in with my Google account, so that I can participate in raffles and manage my account without creating a separate password.

#### Acceptance Criteria

1. THE Auth_Service SHALL support authentication exclusively via Google OAuth 2.0 in Alpha. No email/password registration or sign-in is available.
2. WHEN a visitor completes Google OAuth sign-in for the first time, THE Auth_Service SHALL automatically create a User account using the verified email and profile from Google.
3. WHEN a returning User completes Google OAuth sign-in, THE Auth_Service SHALL authenticate the User and establish a session.
4. IF Google OAuth authentication fails or is denied by the User, THEN THE Auth_Service SHALL return a descriptive error and not create or modify any account.
5. WHEN an authenticated User updates their bank account information, THE Preference_Service SHALL save the updated information to the User's profile.
6. THE System SHALL NOT store passwords or support password reset flows in Alpha.

---

### Requirement 9: Infrastructure Security

**User Story:** As a platform operator, I want the infrastructure to be secured by design, so that user data and system integrity are protected.

#### Acceptance Criteria

1. THE Web_Server SHALL run on a separate physical machine from the DB_Server.
2. THE DB_Server SHALL not be directly connected to the public internet.
3. THE DB_Server SHALL be protected by both a logical firewall and a physical firewall.
4. THE DB_Server SHALL encrypt all personally identifiable user information at rest.

---

### Requirement 10: Performance

**User Story:** As a user, I want the site to load and respond quickly, so that my experience is smooth and frustration-free.

#### Acceptance Criteria

1. THE System SHALL render the homepage within 2 seconds under normal load conditions.
2. WHEN a User submits a bid, THE System SHALL acknowledge the bid within 1 second under normal load conditions.

---

### Requirement 11: AI Agent — Operational Monitoring and Reporting

**User Story:** As an admin, I want an AI agent to proactively monitor server logs and deliver operational reports, so that I can stay informed of system health without manually reviewing logs.

#### Acceptance Criteria

1. THE System SHALL include an AI_Ops_Agent that continuously monitors application and server logs in real time.
2. WHEN the AI_Ops_Agent detects an anomaly (error spike, latency degradation, repeated failed auth attempts, unusual bid patterns), THE System SHALL generate an alert and notify the Admin within 5 minutes of detection.
3. THE AI_Ops_Agent SHALL produce a scheduled operational report delivered to the Admin at a configurable interval (default: daily).
4. WHEN generating a report, THE AI_Ops_Agent SHALL include: error rates, request latency percentiles, active raffle status, Twiq transaction volume, failed login attempts, and any anomalies detected since the last report.
5. THE AI_Ops_Agent SHALL classify log events by severity (info, warning, error, critical) and surface only actionable items in alerts.
6. THE AI_Ops_Agent SHALL retain a searchable log index for a minimum of 30 days.
7. IF the AI_Ops_Agent itself becomes unavailable, THE System SHALL emit a watchdog alert to the Admin via a secondary notification channel (e.g. email fallback).
