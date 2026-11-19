-- Persist the human-confirmed scale for percentage-labelled power-factor data.
-- Existing mappings remain valid and unresolved historical mappings stay NULL.
ALTER TABLE dataset_column_mappings ADD COLUMN value_scale TEXT
    CHECK (
        value_scale IS NULL
        OR (
            target_field = 'power_factor'
            AND measurement_unit = '%'
            AND value_scale IN ('ratio_0_1', 'percent_0_100')
        )
    );
