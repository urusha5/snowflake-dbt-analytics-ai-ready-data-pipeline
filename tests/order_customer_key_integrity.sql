SELECT transaction_id
FROM {{ ref('orders') }} AS o
WHERE o.customer_key <> {{ customer_key('o.customer_id') }}
