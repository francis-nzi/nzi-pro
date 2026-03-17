# Render Cutover Worksheet

This is the filled working sheet for the NZI Pro clean-environment rebuild and cutover.

Use this alongside:

- [RENDER_CUTOVER_CHECKLIST.md](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations%20/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/RENDER_CUTOVER_CHECKLIST.md)
- [RESET_ENVIRONMENT_RUNBOOK.md](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations%20/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/RESET_ENVIRONMENT_RUNBOOK.md)
- [9001_reset_business_data_for_clean_wfm_reload.sql](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations%20/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/sql_migrations/9001_reset_business_data_for_clean_wfm_reload.sql)

## Current Production Stack

Known from [render.yaml](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations%20/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/render.yaml):

- API service: `nzi-pro-api-prod`
- Web service: `nzi-pro-web-prod`
- API URL: `https://nzi-pro-api-prod.onrender.com`
- Web URL: `https://nzi-pro-web-prod.onrender.com`

Known from current setup work:

- Microsoft 365 storage is configured on the API side
- SharePoint site host: `netzerointernational.sharepoint.com`
- SharePoint site path: `/sites/NZIProFiles`
- SharePoint root path: `NZI/job-files`

## Proposed Clean Replacement Stack

Recommended names:

- Database: `nzi-pro-db-clean`
- API service: `nzi-pro-api-clean`
- Web service: `nzi-pro-web-clean`

Recommended URLs after service creation:

- API URL: `https://nzi-pro-api-clean.onrender.com`
- Web URL: `https://nzi-pro-web-clean.onrender.com`

## API Service Settings

Carry over from production:

- runtime: `python`
- build command:

```text
pip install -r requirements.txt && pip uninstall -y multipart || true && pip install python-multipart==0.0.20
```

- start command:

```text
uvicorn api.main:app --host 0.0.0.0 --port $PORT
```

- health check path:

```text
/health
```

### API Environment Variables

Keep the same variable set as production, but point database values to the new database.

Required:

- `PYTHON_VERSION=3.13.12`
- `DB_BACKEND=postgres`
- `APP_ENV=production`
- `DATABASE_URL=<new clean render postgres url>`
- `NZI_JWT_SECRET=<copy from production>`

Likely required in your environment:

- `OPENAI_API_KEY=<copy from production if used>`
- `ANTHROPIC_API_KEY=<copy from production if used>`
- `SMTP_USER=<copy from production>`
- `SMTP_PASS=<copy from production>`
- `MS_TENANT_ID=<copy from production>`
- `MS_CLIENT_ID=<copy from production>`
- `MS_CLIENT_SECRET=<copy from production>`
- `MS_ONEDRIVE_SITE_HOST=netzerointernational.sharepoint.com`
- `MS_ONEDRIVE_SITE_PATH=/sites/NZIProFiles`
- `MS_ONEDRIVE_ROOT_PATH=NZI/job-files`

Optional / environment-specific:

- `WFM_RAW_DATA_DIR=<set if you use an external raw-data location>`
- `CORS_ORIGINS=<set to include the clean web URL if needed>`

## Web Service Settings

Carry over from production:

- runtime: `node`
- root dir: `frontend`
- build command:

```text
npm ci && NEXT_PRIVATE_BUILD_WORKER=1 NODE_OPTIONS=--max-old-space-size=2048 npm run build
```

If you want to match `render.yaml` exactly, the baseline is:

```text
npm ci && npm run build
```

- start command:

```text
npm run start
```

### Web Environment Variables

Required:

- `NODE_VERSION=22`
- `NEXT_PUBLIC_API_BASE_URL=https://nzi-pro-api-clean.onrender.com`
- `BACKEND_API_BASE_URL=https://nzi-pro-api-clean.onrender.com`

If any additional frontend env vars exist in the current Render web service, copy them too.

## Database Plan

Create a fresh Render Postgres instance and use it only for the clean environment.

After the first deploy and migration:

1. connect to the new database
2. run:
   - [9001_reset_business_data_for_clean_wfm_reload.sql](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations%20/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/sql_migrations/9001_reset_business_data_for_clean_wfm_reload.sql)
3. verify:
   - `users` still present
   - `custom_field_definitions` still present
   - `clients`, `jobs`, `datasets`, `factor_lookup` empty

## Execution Plan

### Phase 1: Create Clean Stack

- Create `nzi-pro-db-clean`
- Create `nzi-pro-api-clean`
- Create `nzi-pro-web-clean`
- Copy env vars from production
- Update web service API URL variables to point to the clean API

### Phase 2: First Deploy

- Deploy API
- Deploy web
- Verify:
  - login page loads
  - API `/health` works
  - admin sign-in works

### Phase 3: Reset New DB

- Run:
  - [9001_reset_business_data_for_clean_wfm_reload.sql](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations%20/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/sql_migrations/9001_reset_business_data_for_clean_wfm_reload.sql)

### Phase 4: Reload Core Data

Order:

1. upload fresh datasets
2. verify factor search
3. verify job data upload template
4. verify spend template and `Spend Conversions`
5. import WFM clients
6. import WFM jobs

### Phase 5: Validate

Check:

- 5 sample clients
- 10 sample jobs
- file upload to SharePoint
- template download
- spend workflow
- reporting pages

### Phase 6: Cutover

Choose one:

- move custom domains from:
  - `nzi-pro-api-prod` -> `nzi-pro-api-clean`
  - `nzi-pro-web-prod` -> `nzi-pro-web-clean`
- or soft-launch using clean URLs first, then switch domains later

## Pre-Go-Live Checklist

- [ ] Production DB backup taken
- [ ] Production env vars copied
- [ ] Clean DB created
- [ ] Clean API created
- [ ] Clean web created
- [ ] Clean stack deployed successfully
- [ ] Reset SQL run on clean DB
- [ ] Fresh datasets uploaded
- [ ] Spend template validated
- [ ] WFM clients imported
- [ ] WFM jobs imported
- [ ] SharePoint file uploads validated
- [ ] Admin login validated
- [ ] Standard user login validated
- [ ] Cutover window agreed

## Fill-In Values

Complete these before cutover:

- New clean DB internal name: `________________`
- New clean API URL: `________________`
- New clean web URL: `________________`
- Date/time of cutover: `________________`
- Approved by: `________________`
- Rollback owner: `________________`
- Production DB backup location: `________________`

## Notes Specific To NZI Pro

- The spend upload template is dynamically generated in [spend_data_routes.py](/c:/Users/franc/Net%20Zero%20International/NZI%20Company%20Documents%20-%20Documents/Operations%20/Technical%20Systems/Carbon%20Reporting%20Python/nzi_pro_v7-POSTGRES/api/spend_data_routes.py), so validate datasets before reviewing the final template behavior.
- Job file uploads now depend on Microsoft 365 / SharePoint config on the API service, so that config must be present in the clean API before testing files.
- Keep the current production stack available as a read-only/archive reference until the new stack has been stable for at least a short bedding-in period.
