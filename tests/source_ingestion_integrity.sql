{% if var('source_loaded_at_field', none) %}
SELECT 'raw_customer' AS source_name, TO_VARCHAR(customer_id) AS record_id
FROM {{ source('bronze', 'raw_customer') }}
WHERE TRY_TO_TIMESTAMP_NTZ(TO_VARCHAR({{ source_column('source_loaded_at_field', 'NULL') }})) IS NULL
UNION ALL
SELECT 'raw_product', TO_VARCHAR(product_id)
FROM {{ source('bronze', 'raw_product') }}
WHERE TRY_TO_TIMESTAMP_NTZ(TO_VARCHAR({{ source_column('source_loaded_at_field', 'NULL') }})) IS NULL
UNION ALL
SELECT 'raw_orders', TO_VARCHAR(transaction_id)
FROM {{ source('bronze', 'raw_orders') }}
WHERE TRY_TO_TIMESTAMP_NTZ(TO_VARCHAR({{ source_column('source_loaded_at_field', 'NULL') }})) IS NULL
{% else %}
SELECT NULL AS source_name, NULL AS record_id WHERE FALSE
{% endif %}
