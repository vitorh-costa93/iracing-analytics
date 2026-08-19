


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."car_group_members" (
    "car_group_id" bigint NOT NULL,
    "car_id" bigint NOT NULL
);


ALTER TABLE "public"."car_group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."car_groups" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "platform" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."car_groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."car_rating_categories" (
    "car_id" bigint NOT NULL,
    "rating_category" "text" NOT NULL,
    "source" "text" DEFAULT 'derived'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "valid_rating_category" CHECK (("rating_category" = ANY (ARRAY['formula_car'::"text", 'sports_car'::"text", 'oval'::"text", 'dirt_oval'::"text", 'dirt_road'::"text", 'road'::"text"])))
);


ALTER TABLE "public"."car_rating_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cars" (
    "id" integer NOT NULL,
    "platform" "text",
    "platform_id" "text",
    "name" "text" NOT NULL,
    "variant" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."cars" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_statistics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid",
    "statistic_date" "date" NOT NULL,
    "car_id" integer,
    "track_id" integer,
    "session_type" integer,
    "events" integer,
    "time_on_track" double precision,
    "laps_driven" integer,
    "clean_laps_driven" integer
);


ALTER TABLE "public"."daily_statistics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drivers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "platform" "text" DEFAULT 'iracing'::"text" NOT NULL,
    "platform_driver_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."drivers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driving_sessions" (
    "id" bigint NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "garage61_event_id" "text" NOT NULL,
    "garage61_session_id" "text" NOT NULL,
    "car_id" bigint,
    "track_id" bigint,
    "season_id" "text",
    "season_name" "text",
    "session_type" integer,
    "event_type" integer,
    "started_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "lap_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."driving_sessions" OWNER TO "postgres";


ALTER TABLE "public"."driving_sessions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."driving_sessions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lap_sectors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lap_id" "text" NOT NULL,
    "sector_number" integer NOT NULL,
    "sector_time" double precision,
    "incomplete" boolean DEFAULT false
);


ALTER TABLE "public"."lap_sectors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."laps" (
    "id" "text" NOT NULL,
    "session_id" "uuid",
    "driver_id" "uuid",
    "car_id" integer,
    "track_id" integer,
    "lap_number" integer,
    "lap_time" double precision,
    "clean" boolean,
    "joker" boolean,
    "discontinuity" boolean,
    "missing" boolean,
    "incomplete" boolean,
    "off_track" boolean,
    "pit_lane" boolean,
    "pit_in" boolean,
    "pit_out" boolean,
    "driver_rating" integer,
    "fuel_level" double precision,
    "fuel_used" double precision,
    "fuel_added" double precision,
    "weight_penalty" double precision,
    "power_adjust" double precision,
    "tire_compound" integer,
    "can_view_telemetry" boolean,
    "can_view_setup" boolean,
    "telemetry_path" "text",
    "garage61_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."laps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rating_history" (
    "id" bigint NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "rating_type" "text" NOT NULL,
    "recorded_at" timestamp with time zone NOT NULL,
    "rating" integer NOT NULL,
    "rating_display" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rating_history" OWNER TO "postgres";


ALTER TABLE "public"."rating_history" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."rating_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "rating_type" "text" NOT NULL,
    "rating" integer,
    "rating_display" "text",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "garage61_event_id" "text",
    "garage61_session_id" "text",
    "driver_id" "uuid",
    "car_id" integer,
    "track_id" integer,
    "season_id" "text",
    "season_name" "text",
    "event_type" integer,
    "session_type" integer,
    "run" integer,
    "started_at" timestamp with time zone,
    "air_pressure" double precision,
    "wind_velocity" double precision,
    "wind_direction" double precision,
    "relative_humidity" double precision,
    "fog_level" double precision,
    "track_temp" double precision,
    "track_usage" integer,
    "track_wetness" double precision,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sync_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sync_type" "text" NOT NULL,
    "status" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "records_found" integer DEFAULT 0,
    "records_inserted" integer DEFAULT 0,
    "records_updated" integer DEFAULT 0,
    "error_message" "text"
);


ALTER TABLE "public"."sync_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tracks" (
    "id" integer NOT NULL,
    "platform" "text",
    "platform_id" "text",
    "name" "text" NOT NULL,
    "variant" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tracks" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_race_irating_candidates" AS
 WITH "races" AS (
         SELECT "ds"."id" AS "session_id",
            "ds"."driver_id",
            "ds"."garage61_event_id",
            "ds"."started_at",
            "ds"."ended_at",
            "ds"."car_id",
            "ds"."track_id",
            "crc"."rating_category",
            "c"."name" AS "car",
            "t"."name" AS "track",
            ( SELECT "cg"."name"
                   FROM ("public"."car_group_members" "cgm"
                     JOIN "public"."car_groups" "cg" ON (("cg"."id" = "cgm"."car_group_id")))
                  WHERE ("cgm"."car_id" = "ds"."car_id")
                 LIMIT 1) AS "car_class"
           FROM ((("public"."driving_sessions" "ds"
             JOIN "public"."cars" "c" ON (("c"."id" = "ds"."car_id")))
             LEFT JOIN "public"."tracks" "t" ON (("t"."id" = "ds"."track_id")))
             JOIN "public"."car_rating_categories" "crc" ON (("crc"."car_id" = "ds"."car_id")))
          WHERE ("ds"."session_type" = 3)
        ), "rating_base" AS (
         SELECT "rating_history"."driver_id",
            "rating_history"."category",
            "rating_history"."recorded_at",
            "rating_history"."rating",
            "lag"("rating_history"."rating") OVER (PARTITION BY "rating_history"."driver_id", "rating_history"."category" ORDER BY "rating_history"."recorded_at") AS "previous_rating"
           FROM "public"."rating_history"
          WHERE ("rating_history"."rating_type" = 'irating'::"text")
        ), "rating_changes" AS (
         SELECT "rating_base"."driver_id",
            "rating_base"."category",
            "rating_base"."recorded_at",
            "rating_base"."previous_rating",
            "rating_base"."rating",
            ("rating_base"."rating" - "rating_base"."previous_rating") AS "delta_irating"
           FROM "rating_base"
          WHERE (("rating_base"."previous_rating" IS NOT NULL) AND ("rating_base"."rating" <> "rating_base"."previous_rating"))
        ), "candidates" AS (
         SELECT "r"."session_id",
            "r"."driver_id",
            "r"."garage61_event_id",
            "r"."rating_category",
            "r"."car_class",
            "r"."car",
            "r"."track",
            "r"."started_at",
            "r"."ended_at",
            "h"."recorded_at" AS "rating_at",
            "h"."previous_rating",
            "h"."rating" AS "new_rating",
            "h"."delta_irating",
            (EXTRACT(epoch FROM ("h"."recorded_at" - "r"."ended_at")) / 60.0) AS "minutes_after_race",
            "row_number"() OVER (PARTITION BY "r"."session_id" ORDER BY "h"."recorded_at") AS "candidate_for_race",
            "row_number"() OVER (PARTITION BY "h"."driver_id", "h"."category", "h"."recorded_at" ORDER BY "r"."ended_at" DESC) AS "race_for_rating"
           FROM ("races" "r"
             JOIN "rating_changes" "h" ON ((("h"."driver_id" = "r"."driver_id") AND ("h"."category" = "r"."rating_category") AND ("h"."recorded_at" >= "r"."ended_at") AND ("h"."recorded_at" <= ("r"."ended_at" + '06:00:00'::interval)))))
        )
 SELECT "session_id",
    "driver_id",
    "garage61_event_id",
    "rating_category",
    "car_class",
    "car",
    "track",
    "started_at",
    "ended_at",
    "rating_at",
    "previous_rating",
    "new_rating",
    "delta_irating",
    "minutes_after_race",
    "candidate_for_race",
    "race_for_rating"
   FROM "candidates";


ALTER VIEW "public"."v_race_irating_candidates" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_historical_performance" AS
 SELECT "rating_category",
        CASE
            WHEN ("car" = 'Dallara P217'::"text") THEN 'LMP2'::"text"
            ELSE "car_class"
        END AS "car_class",
    "car",
    "track",
    "count"(*) AS "races",
    "sum"("delta_irating") AS "delta_irating",
    "round"("avg"("delta_irating"), 1) AS "avg_delta_irating",
    "round"(("percentile_cont"((0.5)::double precision) WITHIN GROUP (ORDER BY (("delta_irating")::double precision)))::numeric, 1) AS "median_delta_irating",
    "count"(*) FILTER (WHERE ("delta_irating" > 0)) AS "positive_races",
    "count"(*) FILTER (WHERE ("delta_irating" < 0)) AS "negative_races",
    "round"(((100.0 * ("count"(*) FILTER (WHERE ("delta_irating" > 0)))::numeric) / (NULLIF("count"(*), 0))::numeric), 1) AS "positive_pct",
    "min"("delta_irating") AS "worst_race",
    "max"("delta_irating") AS "best_race",
    "min"("ended_at") AS "first_race_at",
    "max"("ended_at") AS "last_race_at"
   FROM "public"."v_race_irating_candidates"
  WHERE (("candidate_for_race" = 1) AND ("race_for_rating" = 1))
  GROUP BY "rating_category",
        CASE
            WHEN ("car" = 'Dallara P217'::"text") THEN 'LMP2'::"text"
            ELSE "car_class"
        END, "car", "track";


ALTER VIEW "public"."v_historical_performance" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_season_category_summary" AS
 WITH "races" AS (
         SELECT "ds"."season_id",
            "ds"."season_name",
            "v"."rating_category",
            "v"."session_id",
            "v"."delta_irating"
           FROM ("public"."v_race_irating_candidates" "v"
             JOIN "public"."driving_sessions" "ds" ON (("ds"."id" = "v"."session_id")))
          WHERE (("v"."candidate_for_race" = 1) AND ("v"."race_for_rating" = 1))
        )
 SELECT "season_id",
    "season_name",
    "rating_category",
    "count"(*) AS "corridas",
    "sum"("delta_irating") AS "delta_irating",
    "round"("avg"("delta_irating"), 1) AS "delta_medio",
    "round"(("percentile_cont"((0.5)::double precision) WITHIN GROUP (ORDER BY (("delta_irating")::double precision)))::numeric, 1) AS "mediana",
    "count"(*) FILTER (WHERE ("delta_irating" > 0)) AS "corridas_positivas",
    "count"(*) FILTER (WHERE ("delta_irating" < 0)) AS "corridas_negativas",
    "round"(((100.0 * ("count"(*) FILTER (WHERE ("delta_irating" > 0)))::numeric) / ("count"(*))::numeric), 1) AS "pct_positivas",
    "max"("delta_irating") AS "maior_ganho",
    "min"("delta_irating") AS "maior_perda"
   FROM "races"
  GROUP BY "season_id", "season_name", "rating_category";


ALTER VIEW "public"."v_season_category_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_season_summary" AS
 WITH "session_stats" AS (
         SELECT "driving_sessions"."season_id",
            "driving_sessions"."season_name",
            "min"("driving_sessions"."started_at") AS "started_at",
            "max"("driving_sessions"."ended_at") AS "last_activity_at",
            "count"(*) AS "sessions",
            "count"(*) FILTER (WHERE ("driving_sessions"."session_type" = 1)) AS "practice_sessions",
            "count"(*) FILTER (WHERE ("driving_sessions"."session_type" = 2)) AS "qualifying_sessions",
            "count"(*) FILTER (WHERE ("driving_sessions"."session_type" = 3)) AS "race_sessions",
            COALESCE("sum"("driving_sessions"."lap_count"), (0)::bigint) AS "total_laps",
            COALESCE("sum"("driving_sessions"."lap_count") FILTER (WHERE ("driving_sessions"."session_type" = 1)), (0)::bigint) AS "practice_laps",
            COALESCE("sum"("driving_sessions"."lap_count") FILTER (WHERE ("driving_sessions"."session_type" = 2)), (0)::bigint) AS "qualifying_laps",
            COALESCE("sum"("driving_sessions"."lap_count") FILTER (WHERE ("driving_sessions"."session_type" = 3)), (0)::bigint) AS "race_laps"
           FROM "public"."driving_sessions"
          WHERE ("driving_sessions"."season_id" IS NOT NULL)
          GROUP BY "driving_sessions"."season_id", "driving_sessions"."season_name"
        ), "rating_stats" AS (
         SELECT "ds"."season_id",
            "count"(*) AS "races_with_irating",
            "sum"("v"."delta_irating") AS "delta_irating",
            "count"(*) FILTER (WHERE ("v"."delta_irating" > 0)) AS "positive_races",
            "count"(*) FILTER (WHERE ("v"."delta_irating" < 0)) AS "negative_races",
            "round"("avg"("v"."delta_irating"), 1) AS "avg_delta_irating"
           FROM ("public"."v_race_irating_candidates" "v"
             JOIN "public"."driving_sessions" "ds" ON (("ds"."id" = "v"."session_id")))
          WHERE (("v"."candidate_for_race" = 1) AND ("v"."race_for_rating" = 1))
          GROUP BY "ds"."season_id"
        )
 SELECT "s"."season_id",
    "s"."season_name",
    "s"."started_at",
    "s"."last_activity_at",
    "s"."sessions",
    "s"."practice_sessions",
    "s"."qualifying_sessions",
    "s"."race_sessions",
    "s"."total_laps",
    "s"."practice_laps",
    "s"."qualifying_laps",
    "s"."race_laps",
    COALESCE("r"."races_with_irating", (0)::bigint) AS "races_with_irating",
    COALESCE("r"."delta_irating", (0)::bigint) AS "delta_irating",
    COALESCE("r"."positive_races", (0)::bigint) AS "positive_races",
    COALESCE("r"."negative_races", (0)::bigint) AS "negative_races",
    "r"."avg_delta_irating",
        CASE
            WHEN ("r"."races_with_irating" > 0) THEN "round"(((100.0 * ("r"."positive_races")::numeric) / ("r"."races_with_irating")::numeric), 1)
            ELSE NULL::numeric
        END AS "positive_race_pct"
   FROM ("session_stats" "s"
     LEFT JOIN "rating_stats" "r" ON (("r"."season_id" = "s"."season_id")));


ALTER VIEW "public"."v_season_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_season_weekly_irating" AS
 WITH "season_dates" AS (
         SELECT '31'::"text" AS "season_id",
            '2025 Season 4'::"text" AS "season_name",
            '2025-09-16 00:00:00+00'::timestamp with time zone AS "season_start"
        UNION ALL
         SELECT '32'::"text",
            '2026 Season 1'::"text",
            '2025-12-16 00:00:00+00'::timestamp with time zone AS "timestamptz"
        UNION ALL
         SELECT '33'::"text",
            '2026 Season 2'::"text",
            '2026-03-17 00:00:00+00'::timestamp with time zone AS "timestamptz"
        UNION ALL
         SELECT '34'::"text",
            '2026 Season 3'::"text",
            '2026-06-16 00:00:00+00'::timestamp with time zone AS "timestamptz"
        ), "weeks" AS (
         SELECT "s"."season_id",
            "s"."season_name",
            "s"."season_start",
            "gs"."gs" AS "week_number",
            ("s"."season_start" + ((("gs"."gs" - 1))::double precision * '7 days'::interval)) AS "week_start",
            ("s"."season_start" + (("gs"."gs")::double precision * '7 days'::interval)) AS "week_end"
           FROM ("season_dates" "s"
             CROSS JOIN "generate_series"(1, 12) "gs"("gs"))
        ), "categories" AS (
         SELECT 'formula_car'::"text" AS "rating_category"
        UNION ALL
         SELECT 'sports_car'::"text"
        ), "grid" AS (
         SELECT "w"."season_id",
            "w"."season_name",
            "w"."week_number",
            "w"."week_start",
            "w"."week_end",
            "c"."rating_category"
           FROM ("weeks" "w"
             CROSS JOIN "categories" "c")
        ), "session_base" AS (
         SELECT "ds"."id",
            "ds"."season_id",
            "ds"."session_type",
            (("floor"((EXTRACT(epoch FROM ("ds"."started_at" - "sd"."season_start")) / (604800)::numeric)))::integer + 1) AS "week_number",
            "crc"."rating_category",
            "c"."name" AS "car",
            "t"."name" AS "track"
           FROM (((("public"."driving_sessions" "ds"
             JOIN "season_dates" "sd" ON (("sd"."season_id" = "ds"."season_id")))
             JOIN "public"."car_rating_categories" "crc" ON (("crc"."car_id" = "ds"."car_id")))
             LEFT JOIN "public"."cars" "c" ON (("c"."id" = "ds"."car_id")))
             LEFT JOIN "public"."tracks" "t" ON (("t"."id" = "ds"."track_id")))
          WHERE ("crc"."rating_category" = ANY (ARRAY['formula_car'::"text", 'sports_car'::"text"]))
        ), "activity" AS (
         SELECT "session_base"."season_id",
            "session_base"."rating_category",
            "session_base"."week_number",
            "count"(*) FILTER (WHERE ("session_base"."session_type" = 3)) AS "races",
            "array_agg"(DISTINCT "session_base"."car") FILTER (WHERE ("session_base"."car" IS NOT NULL)) AS "cars",
            "array_agg"(DISTINCT "session_base"."track") FILTER (WHERE ("session_base"."track" IS NOT NULL)) AS "tracks"
           FROM "session_base"
          WHERE (("session_base"."week_number" >= 1) AND ("session_base"."week_number" <= 12))
          GROUP BY "session_base"."season_id", "session_base"."rating_category", "session_base"."week_number"
        ), "rating_base" AS (
         SELECT "sd"."season_id",
            "rh"."category" AS "rating_category",
            (("floor"((EXTRACT(epoch FROM ("rh"."recorded_at" - "sd"."season_start")) / (604800)::numeric)))::integer + 1) AS "week_number",
            "rh"."recorded_at",
            "rh"."rating"
           FROM ("public"."rating_history" "rh"
             JOIN "season_dates" "sd" ON ((("rh"."recorded_at" >= "sd"."season_start") AND ("rh"."recorded_at" < ("sd"."season_start" + '84 days'::interval)))))
          WHERE (("rh"."rating_type" = 'irating'::"text") AND ("rh"."category" = ANY (ARRAY['formula_car'::"text", 'sports_car'::"text"])))
        ), "rating_week" AS (
         SELECT "rating_base"."season_id",
            "rating_base"."rating_category",
            "rating_base"."week_number",
            ("array_agg"("rating_base"."rating" ORDER BY "rating_base"."recorded_at"))[1] AS "irating_first",
            ("array_agg"("rating_base"."rating" ORDER BY "rating_base"."recorded_at" DESC))[1] AS "irating_last",
            "min"("rating_base"."rating") AS "irating_min",
            "max"("rating_base"."rating") AS "irating_max",
            "count"(*) AS "rating_changes",
            "min"("rating_base"."recorded_at") AS "first_rating_at",
            "max"("rating_base"."recorded_at") AS "last_rating_at"
           FROM "rating_base"
          WHERE (("rating_base"."week_number" >= 1) AND ("rating_base"."week_number" <= 12))
          GROUP BY "rating_base"."season_id", "rating_base"."rating_category", "rating_base"."week_number"
        ), "final_base" AS (
         SELECT "g"."season_id",
            "g"."season_name",
            "g"."rating_category",
            "g"."week_number",
            "g"."week_start",
            "g"."week_end",
            "before_week"."rating" AS "irating_before_week",
            "rw"."irating_first",
            COALESCE("rw"."irating_last", "before_week"."rating") AS "irating_end_of_week",
                CASE
                    WHEN (("rw"."irating_last" IS NOT NULL) AND ("before_week"."rating" IS NOT NULL)) THEN ("rw"."irating_last" - "before_week"."rating")
                    ELSE 0
                END AS "weekly_delta",
            "rw"."irating_min",
            "rw"."irating_max",
            COALESCE("rw"."rating_changes", (0)::bigint) AS "rating_changes",
            "rw"."first_rating_at",
            "rw"."last_rating_at",
            COALESCE("a"."races", (0)::bigint) AS "races",
            COALESCE("a"."cars", ARRAY[]::"text"[]) AS "cars",
            COALESCE("a"."tracks", ARRAY[]::"text"[]) AS "tracks"
           FROM ((("grid" "g"
             LEFT JOIN "activity" "a" ON ((("a"."season_id" = "g"."season_id") AND ("a"."rating_category" = "g"."rating_category") AND ("a"."week_number" = "g"."week_number"))))
             LEFT JOIN "rating_week" "rw" ON ((("rw"."season_id" = "g"."season_id") AND ("rw"."rating_category" = "g"."rating_category") AND ("rw"."week_number" = "g"."week_number"))))
             LEFT JOIN LATERAL ( SELECT "rh"."rating"
                   FROM "public"."rating_history" "rh"
                  WHERE (("rh"."category" = "g"."rating_category") AND ("rh"."rating_type" = 'irating'::"text") AND ("rh"."recorded_at" < "g"."week_start"))
                  ORDER BY "rh"."recorded_at" DESC
                 LIMIT 1) "before_week" ON (true))
        )
 SELECT "season_id",
    "season_name",
    "rating_category",
    "week_number",
    "week_start",
    "week_end",
    "irating_before_week",
    "irating_first",
    "irating_end_of_week",
    "weekly_delta",
    "irating_min",
    "irating_max",
    "rating_changes",
    "first_rating_at",
    "last_rating_at",
    "races",
    "cars",
    "tracks"
   FROM "final_base";


ALTER VIEW "public"."v_season_weekly_irating" OWNER TO "postgres";


ALTER TABLE ONLY "public"."car_group_members"
    ADD CONSTRAINT "car_group_members_pkey" PRIMARY KEY ("car_group_id", "car_id");



ALTER TABLE ONLY "public"."car_groups"
    ADD CONSTRAINT "car_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."car_rating_categories"
    ADD CONSTRAINT "car_rating_categories_pkey" PRIMARY KEY ("car_id");



ALTER TABLE ONLY "public"."cars"
    ADD CONSTRAINT "cars_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_statistics"
    ADD CONSTRAINT "daily_statistics_driver_id_statistic_date_car_id_track_id_s_key" UNIQUE ("driver_id", "statistic_date", "car_id", "track_id", "session_type");



ALTER TABLE ONLY "public"."daily_statistics"
    ADD CONSTRAINT "daily_statistics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_platform_driver_id_key" UNIQUE ("platform_driver_id");



ALTER TABLE ONLY "public"."driving_sessions"
    ADD CONSTRAINT "driving_sessions_driver_id_garage61_event_id_garage61_sessi_key" UNIQUE ("driver_id", "garage61_event_id", "garage61_session_id", "car_id", "track_id");



ALTER TABLE ONLY "public"."driving_sessions"
    ADD CONSTRAINT "driving_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lap_sectors"
    ADD CONSTRAINT "lap_sectors_lap_id_sector_number_key" UNIQUE ("lap_id", "sector_number");



ALTER TABLE ONLY "public"."lap_sectors"
    ADD CONSTRAINT "lap_sectors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."laps"
    ADD CONSTRAINT "laps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rating_history"
    ADD CONSTRAINT "rating_history_driver_id_category_rating_type_recorded_at_key" UNIQUE ("driver_id", "category", "rating_type", "recorded_at");



ALTER TABLE ONLY "public"."rating_history"
    ADD CONSTRAINT "rating_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sync_runs"
    ADD CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tracks"
    ADD CONSTRAINT "tracks_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_car_group_members_car" ON "public"."car_group_members" USING "btree" ("car_id");



CREATE INDEX "idx_daily_statistics_date" ON "public"."daily_statistics" USING "btree" ("statistic_date" DESC);



CREATE INDEX "idx_driving_sessions_driver_time" ON "public"."driving_sessions" USING "btree" ("driver_id", "started_at");



CREATE INDEX "idx_driving_sessions_type" ON "public"."driving_sessions" USING "btree" ("session_type");



CREATE INDEX "idx_laps_car" ON "public"."laps" USING "btree" ("car_id");



CREATE INDEX "idx_laps_driver" ON "public"."laps" USING "btree" ("driver_id");



CREATE INDEX "idx_laps_session" ON "public"."laps" USING "btree" ("session_id");



CREATE INDEX "idx_laps_track" ON "public"."laps" USING "btree" ("track_id");



CREATE INDEX "idx_rating_history_driver_category_time" ON "public"."rating_history" USING "btree" ("driver_id", "category", "rating_type", "recorded_at");



CREATE INDEX "idx_ratings_driver_recorded" ON "public"."ratings" USING "btree" ("driver_id", "recorded_at" DESC);



CREATE INDEX "idx_sessions_car" ON "public"."sessions" USING "btree" ("car_id");



CREATE INDEX "idx_sessions_driver_started" ON "public"."sessions" USING "btree" ("driver_id", "started_at" DESC);



CREATE INDEX "idx_sessions_track" ON "public"."sessions" USING "btree" ("track_id");



CREATE UNIQUE INDEX "uq_sessions_g61_identity" ON "public"."sessions" USING "btree" ("garage61_event_id", "garage61_session_id", "driver_id", "car_id", "track_id", "started_at") NULLS NOT DISTINCT;



ALTER TABLE ONLY "public"."car_group_members"
    ADD CONSTRAINT "car_group_members_car_group_id_fkey" FOREIGN KEY ("car_group_id") REFERENCES "public"."car_groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."car_group_members"
    ADD CONSTRAINT "car_group_members_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."car_rating_categories"
    ADD CONSTRAINT "car_rating_categories_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_statistics"
    ADD CONSTRAINT "daily_statistics_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_statistics"
    ADD CONSTRAINT "daily_statistics_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_statistics"
    ADD CONSTRAINT "daily_statistics_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."driving_sessions"
    ADD CONSTRAINT "driving_sessions_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id");



ALTER TABLE ONLY "public"."driving_sessions"
    ADD CONSTRAINT "driving_sessions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driving_sessions"
    ADD CONSTRAINT "driving_sessions_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id");



ALTER TABLE ONLY "public"."lap_sectors"
    ADD CONSTRAINT "lap_sectors_lap_id_fkey" FOREIGN KEY ("lap_id") REFERENCES "public"."laps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."laps"
    ADD CONSTRAINT "laps_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."laps"
    ADD CONSTRAINT "laps_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."laps"
    ADD CONSTRAINT "laps_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."laps"
    ADD CONSTRAINT "laps_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rating_history"
    ADD CONSTRAINT "rating_history_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "public"."cars"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE SET NULL;



ALTER TABLE "public"."cars" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_statistics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drivers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lap_sectors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."laps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ratings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tracks" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."car_group_members" TO "anon";
GRANT ALL ON TABLE "public"."car_group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."car_group_members" TO "service_role";



GRANT ALL ON TABLE "public"."car_groups" TO "anon";
GRANT ALL ON TABLE "public"."car_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."car_groups" TO "service_role";



GRANT ALL ON TABLE "public"."car_rating_categories" TO "anon";
GRANT ALL ON TABLE "public"."car_rating_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."car_rating_categories" TO "service_role";



GRANT ALL ON TABLE "public"."cars" TO "anon";
GRANT ALL ON TABLE "public"."cars" TO "authenticated";
GRANT ALL ON TABLE "public"."cars" TO "service_role";



GRANT ALL ON TABLE "public"."daily_statistics" TO "anon";
GRANT ALL ON TABLE "public"."daily_statistics" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_statistics" TO "service_role";



GRANT ALL ON TABLE "public"."drivers" TO "anon";
GRANT ALL ON TABLE "public"."drivers" TO "authenticated";
GRANT ALL ON TABLE "public"."drivers" TO "service_role";



GRANT ALL ON TABLE "public"."driving_sessions" TO "anon";
GRANT ALL ON TABLE "public"."driving_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."driving_sessions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."driving_sessions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."driving_sessions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."driving_sessions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lap_sectors" TO "anon";
GRANT ALL ON TABLE "public"."lap_sectors" TO "authenticated";
GRANT ALL ON TABLE "public"."lap_sectors" TO "service_role";



GRANT ALL ON TABLE "public"."laps" TO "anon";
GRANT ALL ON TABLE "public"."laps" TO "authenticated";
GRANT ALL ON TABLE "public"."laps" TO "service_role";



GRANT ALL ON TABLE "public"."rating_history" TO "anon";
GRANT ALL ON TABLE "public"."rating_history" TO "authenticated";
GRANT ALL ON TABLE "public"."rating_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."rating_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."rating_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."rating_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ratings" TO "anon";
GRANT ALL ON TABLE "public"."ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."ratings" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."sync_runs" TO "anon";
GRANT ALL ON TABLE "public"."sync_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_runs" TO "service_role";



GRANT ALL ON TABLE "public"."tracks" TO "anon";
GRANT ALL ON TABLE "public"."tracks" TO "authenticated";
GRANT ALL ON TABLE "public"."tracks" TO "service_role";



GRANT ALL ON TABLE "public"."v_race_irating_candidates" TO "anon";
GRANT ALL ON TABLE "public"."v_race_irating_candidates" TO "authenticated";
GRANT ALL ON TABLE "public"."v_race_irating_candidates" TO "service_role";



GRANT ALL ON TABLE "public"."v_historical_performance" TO "anon";
GRANT ALL ON TABLE "public"."v_historical_performance" TO "authenticated";
GRANT ALL ON TABLE "public"."v_historical_performance" TO "service_role";



GRANT ALL ON TABLE "public"."v_season_category_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_season_category_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_season_category_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_season_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_season_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_season_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_season_weekly_irating" TO "anon";
GRANT ALL ON TABLE "public"."v_season_weekly_irating" TO "authenticated";
GRANT ALL ON TABLE "public"."v_season_weekly_irating" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







