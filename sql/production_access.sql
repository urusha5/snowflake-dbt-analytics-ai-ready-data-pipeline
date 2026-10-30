-- Reviewed bootstrap template. Run deliberately as a Snowflake administrator.
-- Replace PACIFIC_RETAIL_DB / SNOWSTACK_WH with the approved deployment names.
-- No passwords or private keys belong in this file. Service users are provisioned
-- separately with key-pair authentication and network policies.
CREATE ROLE IF NOT EXISTS SNOWSTACK_READER;
CREATE ROLE IF NOT EXISTS SNOWSTACK_TRANSFORMER;
GRANT USAGE ON DATABASE PACIFIC_RETAIL_DB TO ROLE SNOWSTACK_READER;
GRANT USAGE ON DATABASE PACIFIC_RETAIL_DB TO ROLE SNOWSTACK_TRANSFORMER;
GRANT CREATE SCHEMA ON DATABASE PACIFIC_RETAIL_DB TO ROLE SNOWSTACK_TRANSFORMER;
GRANT USAGE ON SCHEMA PACIFIC_RETAIL_DB.BRONZE TO ROLE SNOWSTACK_TRANSFORMER;
GRANT SELECT ON ALL TABLES IN SCHEMA PACIFIC_RETAIL_DB.BRONZE TO ROLE SNOWSTACK_TRANSFORMER;
GRANT SELECT ON FUTURE TABLES IN SCHEMA PACIFIC_RETAIL_DB.BRONZE TO ROLE SNOWSTACK_TRANSFORMER;
GRANT USAGE ON WAREHOUSE SNOWSTACK_WH TO ROLE SNOWSTACK_READER;
GRANT USAGE ON WAREHOUSE SNOWSTACK_WH TO ROLE SNOWSTACK_TRANSFORMER;
-- The transformer owns the schemas/views it creates and grants the reader
-- SELECT on APP_* views after validation. Do not grant the reader raw-table
-- access, broad future SELECT grants, or inheritance from TRANSFORMER.
-- Configure the two separately provisioned service users with their respective
-- role, TIMEZONE=UTC, STATEMENT_TIMEOUT_IN_SECONDS=900, and
-- ABORT_DETACHED_QUERY=TRUE. Set warehouse auto-suspend and a resource monitor
-- according to the approved compute budget. Never use ACCOUNTADMIN in the app.
