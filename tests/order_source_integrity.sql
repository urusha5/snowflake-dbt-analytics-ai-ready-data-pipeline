SELECT transaction_id
FROM {{ source('bronze', 'raw_orders') }}
WHERE TRY_TO_DECIMAL(TO_VARCHAR(quantity), 38, 9) IS NULL
    OR TRY_TO_DECIMAL(TO_VARCHAR(quantity), 38, 9)
        <> FLOOR(TRY_TO_DECIMAL(TO_VARCHAR(quantity), 38, 9))
