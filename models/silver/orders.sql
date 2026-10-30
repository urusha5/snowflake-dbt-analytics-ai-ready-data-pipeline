SELECT

    transaction_id,

    customer_id,

    product_id,

    quantity,

    total_amount,

    transaction_date,

    loaded_at,

    customer_key

FROM {{ ref('stg_orders') }}

-- Retain malformed rows so quality tests fail; never silently discard them.
