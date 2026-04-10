# Lead Generator Spec

## Purpose
Lead Generator is a criteria-driven system for finding, scoring, previewing, and promoting B2B leads into the NZI sales funnel.

It should help the team answer three questions for every lead:

1. Why this company?
2. Why now?
3. Why us?

The feature is not meant to produce random prospects. It should produce explainable matches based on defined inputs.

## Core Outcome
Given a set of criteria, the system should:

- Find real companies and contacts that match the target profile.
- Rank them by fit and data quality.
- Show why each lead matched.
- Allow preview before generation.
- Save repeatable profiles.
- Let the user generate, enrich, qualify, bin, or convert leads.

## Primary Inputs

The generator should support the following variable inputs:

- Industry
- Country
- Region
- City
- Company size
  - Revenue band
  - Employee band
- Buyer role
- Seniority
- Net zero or carbon requirement
- Procurement pressure
- Public sector supply chain exposure
- Growth signals
- Hiring signals
- ESG maturity
- Website and domain clues
- Ownership type
- Trigger events
- Exclusions

## Recommended Lead Strategies

The generator should support different strategy modes. A user can combine them with filters and scoring.

### 1. Firmographic Fit
Find companies that match basic profile criteria.

Best for:

- Building a clean target list
- Mid-market prospecting
- Controlled outreach lists

Example:

- UK construction firms
- 50 to 500 employees
- GBP 5m to 50m revenue

### 2. Net Zero Requirement
Find companies likely to need carbon reporting, reduction plans, or supplier disclosures.

Good signals:

- Tender participation
- Supplier questionnaires
- Procurement language
- Sustainability reporting
- Carbon reduction plan references

Example:

- Suppliers to NHS, councils, or larger enterprise chains
- Construction firms bidding for public work

### 3. Compliance Pressure
Find firms under reporting or disclosure pressure.

Good signals:

- Annual reports
- Sustainability reports
- ESG pages
- Scope 1, 2, or 3 references
- Customer or regulator disclosure requirements

### 4. Growth / Expansion
Find companies that are hiring, expanding, or investing.

Good signals:

- New site announcements
- Hiring spikes
- Capital investment
- Contract wins
- Acquisition activity

### 5. Buyer-Role Targeting
Find companies where the right contact is visible.

Recommended roles:

- Sustainability Manager
- ESG Manager
- Procurement Manager
- Operations Director
- Commercial Director
- Business Development Director
- Bid Manager

### 6. Procurement-Led
Find organisations exposed to tenders, frameworks, and supplier onboarding.

Good signals:

- Procurement pages
- Framework references
- Bid documents
- Supplier onboarding
- Tender portals

### 7. Sector-Specific Plays
Different sectors need different triggers and messaging.

Examples:

- Construction: carbon plans, supplier questionnaires, tender scoring
- Healthcare: supplier disclosure, estates reporting, procurement pressure
- Logistics: fleet emissions, fuel reduction, customer disclosure
- Manufacturing: energy use, process emissions, supply chain transparency
- Property / FM: building performance, tenant reporting
- Professional services: client ESG asks, supplier transparency

## Exclusion Rules

The generator should reject or heavily penalise:

- Consultancies
- Agencies
- Software vendors
- Direct competitors
- Tiny sole traders
- Global enterprises if the target is mid-market
- Companies without a verifiable website
- Duplicate records
- Previously binned companies

## Scoring Model

Use a score from 0 to 100.

Suggested weighting:

- 30 points: firmographic fit
- 25 points: sector or use-case fit
- 20 points: trigger signals
- 15 points: buyer-role fit
- 10 points: data quality

Suggested deductions:

- Missing website
- Missing contact
- Poor evidence
- Wrong geography
- Wrong industry
- Consultancy or software vendor

## Lead Qualification Rules

A lead should only be considered strong if it has:

- Matching industry
- Matching geography
- Matching company size band
- At least one useful trigger signal
- A plausible buyer role
- Source references
- A meaningful score

## Output Contract

Every generated lead should contain:

- Company name
- Industry
- Country
- City
- Website
- Revenue estimate
- Contact name
- Contact role
- Contact email or phone where available
- Likelihood score
- Why good lead
- Trigger reason
- Source references
- Qualification status
- Bin reason if binned

## Generation Modes

### Market Scan
Broad discovery mode.

Use when:

- You want a wider list of companies
- You want to discover market opportunities
- You are not yet sure which services are most relevant

Output:

- More companies
- More variation
- Better for research and enrichment

### Daily Lead Batch
Targeted mode.

Use when:

- You want a smaller, more precise list
- You want ready-to-work leads
- You already know the service line or campaign focus

Output:

- Fewer leads
- Higher precision
- Better for outbound work

## Preview Workflow

Preview should run the same criteria as generation, but without writing to the bin.

Preview should:

- Return candidate leads
- Show scores
- Show why each lead matched
- Show trigger reasons
- Show source references
- Let the user generate the same set after review

## Saved Profiles

Saved profiles should store the full criteria set so a user can rerun them quickly.

Recommended profile fields:

- Name
- Generation mode
- Regions
- Revenue band
- Target industries
- Target roles
- Include keywords
- Exclude keywords
- Minimum score
- Strict matching flag
- Service keys

Suggested profile examples:

- UK Construction Mid-Market
- Healthcare Supplier Prospecting
- Logistics Carbon Pressure
- Public Sector Supply Chain
- Regional Growth Firms

## Data Sources

The generator should work best when it can combine multiple sources:

- Internal market database
- Open web research
- Companies House
- Approved data providers
- Tender or procurement sources

The system should prefer verifiable sources and keep source references visible.

## User Workflow

1. Choose a saved profile or create criteria manually.
2. Set filters and score threshold.
3. Preview matches.
4. Review why each lead matched.
5. Generate leads into the bin.
6. Enrich weak records.
7. Qualify strong leads into the funnel.
8. Bin irrelevant leads with reasons.

## Design Principles

- Deterministic where possible.
- AI-assisted where helpful.
- Explainable at every step.
- Easy to rerun.
- Easy to reject bad matches.
- Built for real outreach, not vanity lists.

## Practical Success Metrics

Measure the system by:

- Preview-to-generation conversion
- Lead-to-funnel conversion
- Lead-to-client conversion
- Binned lead rate
- Enrichment completion rate
- Contact completeness
- Match precision by strategy

## Future Enhancements

Good next additions:

- Shareable profiles across users
- Profile templates by sector
- Saved exclusions by account list
- Trigger-based alerts
- Weekly lead digest
- Source weighting controls
- Score explanation breakdown
- Better contact enrichment

## Current State

The app already supports:

- Criteria-based generation
- Preview mode
- Saved browser profiles
- Sector templates
- Score breakdown per lead
- Source weighting controls
- Lead enrichment
- Funnel qualification
- Bin reasons

The next priority is to keep improving precision and reduce time spent reviewing poor matches.
