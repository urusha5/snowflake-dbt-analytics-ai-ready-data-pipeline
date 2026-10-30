SELECT
    TRY_TO_NUMBER(TO_VARCHAR(transaction_id))::NUMBER(38, 0) AS transaction_id,
    TRY_TO_NUMBER(TO_VARCHAR(customer_id))::NUMBER(38, 0) AS customer_id,
    TRY_TO_NUMBER(TO_VARCHAR(product_id))::NUMBER(38, 0) AS product_id,
    TRY_TO_NUMBER(TO_VARCHAR(quantity))::NUMBER(38, 0) AS quantity,
    TRY_TO_DECIMAL(TO_VARCHAR(total_amount), 18, 2) AS total_amount,
    TRY_TO_DATE(TO_VARCHAR(transaction_date)) AS transaction_date,
    TRY_TO_TIMESTAMP_NTZ(TO_VARCHAR({{ source_column('source_loaded_at_field', 'NULL') }})) AS loaded_at,
    {{ customer_key('TRY_TO_NUMBER(TO_VARCHAR(customer_id))::NUMBER(38, 0)') }} AS customer_key
FROM {{ source('bronze', 'raw_orders') }}
