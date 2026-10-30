{% snapshot customer_snapshot %}

{{
    config(

        target_database=target.database,

        target_schema='SNAPSHOTS',

        unique_key='customer_id',

        strategy='check',

        check_cols=[
            'customer_type',
            'email',
            'age',
            'gender',
            'total_purchases'
        ]

    )
}}

SELECT *

FROM {{ ref('customer') }}

{% endsnapshot %}