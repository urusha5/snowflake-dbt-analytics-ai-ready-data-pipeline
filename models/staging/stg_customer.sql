SELECT
    TRY_TO_NUMBER(TO_VARCHAR(customer_id))::NUMBER(38, 0) AS customer_id,
    customer_type,
    email,
    age,
    gender,
    total_purchases,
    TRY_TO_TIMESTAMP_NTZ(TO_VARCHAR({{ source_column('customer_created_at_field', "'1900-01-01'") }})) AS created_at
FROM {{ source('bronze', 'raw_customer') }}
