-- Run in the intended database with your ingestion role.
-- Existing tables are never replaced. Load your own CSVs with COPY INTO.
CREATE SCHEMA IF NOT EXISTS BRONZE;

CREATE TABLE IF NOT EXISTS BRONZE.RAW_CUSTOMER (
    customer_id NUMBER(38, 0),
    customer_type VARCHAR,
    email VARCHAR,
    age NUMBER(3, 0),
    gender VARCHAR,
    total_purchases NUMBER(18, 0),
    created_at TIMESTAMP_NTZ NOT NULL,
    loaded_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS BRONZE.RAW_PRODUCT (
    product_id NUMBER(38, 0),
    name VARCHAR,
    category VARCHAR,
    price NUMBER(18, 2),
    stock_quantity NUMBER(18, 0),
    rating NUMBER(3, 2),
    available_from DATE NOT NULL,
    loaded_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE TABLE IF NOT EXISTS BRONZE.RAW_ORDERS (
    transaction_id NUMBER(38, 0),
    customer_id NUMBER(38, 0),
    product_id NUMBER(38, 0),
    quantity NUMBER(18, 0),
    total_amount NUMBER(18, 2),
    transaction_date DATE,
    loaded_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Populate loaded_at on each ingestion. CREATE IF NOT EXISTS does not migrate
-- older tables. Then enable freshness with --vars '{source_loaded_at_field: loaded_at}'.
