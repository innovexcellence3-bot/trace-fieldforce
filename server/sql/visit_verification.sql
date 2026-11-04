-- TRACE · Field Force Visit Verification (Presentation to HoZ)
-- Parameter (bind, diisi dari UI):  ? #1 = KPS week awal,  ? #2 = KPS week akhir,  ? #3 = channel
WITH csu_data AS (
    SELECT
        TRIM(customer_code) AS customer_code,
        /* Normalisasi latitude customer */
        CASE
            WHEN latitude BETWEEN -90 AND 90
             AND longitude BETWEEN -180 AND 180
                THEN latitude
            WHEN longitude BETWEEN -90 AND 90
             AND latitude BETWEEN -180 AND 180
                THEN longitude
            ELSE NULL
        END AS isms_lat_customer,
        /* Normalisasi longitude customer */
        CASE
            WHEN latitude BETWEEN -90 AND 90
             AND longitude BETWEEN -180 AND 180
                THEN longitude
            WHEN longitude BETWEEN -90 AND 90
             AND latitude BETWEEN -180 AND 180
                THEN latitude
            ELSE NULL
        END AS isms_lon_customer
    FROM DB_ID_PRD.DATA_PRODUCT_ISMS.F_ISMS_CUSTOMER_SLSTREE
)
SELECT
    TRIM(vdc.customer_code)
        || '_'
        || TO_VARCHAR(vdc.visit_start_timestamp) AS visit_id,
    TRIM(vdc.customer_code) AS customer_code,
    TRIM(sh.channel) AS channel,
    TRIM(sh.customer_segment_internal_classification) AS customer_segment_internal_classification,
    vdc.kps_week,
    /* Normalisasi latitude visit */
    CASE
        WHEN vdc.visit_start_latitude BETWEEN -90 AND 90
         AND vdc.visit_start_longitude BETWEEN -180 AND 180
            THEN vdc.visit_start_latitude
        WHEN vdc.visit_start_longitude BETWEEN -90 AND 90
         AND vdc.visit_start_latitude BETWEEN -180 AND 180
            THEN vdc.visit_start_longitude
        ELSE NULL
    END AS isms_lat_visit,
    /* Normalisasi longitude visit */
    CASE
        WHEN vdc.visit_start_latitude BETWEEN -90 AND 90
         AND vdc.visit_start_longitude BETWEEN -180 AND 180
            THEN vdc.visit_start_longitude
        WHEN vdc.visit_start_longitude BETWEEN -90 AND 90
         AND vdc.visit_start_latitude BETWEEN -180 AND 180
            THEN vdc.visit_start_latitude
        ELSE NULL
    END AS isms_lon_visit,
    vdc.visit_start_timestamp,
    vdc.visit_end_timestamp,
    TRIM(sh.zone_name) AS zone_name,
    TRIM(sh.region_name) AS region_name,
    TRIM(sh.area_name) AS area_name,
    TRIM(sh.sales_point_name) AS sales_point_name,
    TRIM(sh.district_code) AS district_code,
    TRIM(sh.territory_code) AS territory_code,
    cd.isms_lat_customer,
    cd.isms_lon_customer,
    vdc.employee_name,
    vdc.supervisor_name
FROM DB_ID_PRD.DATA_PRODUCT_ISMS.F_ISMS_VISIT_DAILY_CUSTOMER vdc
LEFT JOIN DB_ID_PRD.DATA_PRODUCT_ISMS.F_ISMS_CUSTOMER_SLSTREE_HISTORICAL sh
    ON TRIM(vdc.customer_code) = TRIM(sh.customer_code)
   AND vdc.kps_week = sh.kps_week
LEFT JOIN csu_data cd
    ON TRIM(vdc.customer_code) = cd.customer_code
WHERE vdc.visit_status = 'E'
  AND vdc.customer_code IS NOT NULL
  AND vdc.kps_week BETWEEN ? AND ?
  AND vdc.channel = ?
