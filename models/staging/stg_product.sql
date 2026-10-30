SELECT
    TRY_TO_NUMBER(TO_VARCHAR(product_id))::NUMBER(38, 0) AS product_id,
    name,
    category,
    price,
    stock_quantity,
    rating,
    TRY_TO_DATE(TO_VARCHAR({{ source_column('product_available_from_field', "'1900-01-01'") }})) AS available_from
FROM {{ source('bronze', 'raw_product') }}
