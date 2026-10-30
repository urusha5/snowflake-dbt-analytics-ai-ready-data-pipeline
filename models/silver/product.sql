SELECT

    product_id,

    name,

    INITCAP(category) AS category,

    TRY_TO_DECIMAL(TO_VARCHAR(price), 18, 2) AS price,

    TRY_TO_NUMBER(TO_VARCHAR(stock_quantity)) AS stock_quantity,

    rating,

    available_from

FROM {{ ref('stg_product') }}
