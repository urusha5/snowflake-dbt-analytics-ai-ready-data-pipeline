SELECT 'orders' AS failing_model
WHERE (SELECT COUNT(*) FROM {{ ref('orders') }})
    <> (SELECT COUNT(*) FROM {{ source('bronze', 'raw_orders') }})
