create table if not exists public.race_rating_matches (
  session_id bigint primary key references public.driving_sessions(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  rating_category text not null,
  rating_at timestamptz not null,
  previous_rating integer not null,
  new_rating integer not null,
  delta_irating integer not null,
  gap_hours numeric not null,
  computed_at timestamptz not null default now()
);

create index if not exists idx_race_rating_matches_driver_category
  on public.race_rating_matches (driver_id, rating_category);

alter table public.race_rating_matches enable row level security;
grant all on table public.race_rating_matches to service_role;

comment on table public.race_rating_matches is
  'Race-to-iRating-change pairing computed by a greedy monotonic matching algorithm (chronological, each rating change used at most once), replacing the old nearest-neighbor heuristic in v_race_irating_candidates which could misattribute a rating change to a nearby short/aborted race instead of the real longer race that caused it.';

-- v_race_irating_candidates now reads the pairing from this precomputed table instead of doing
-- live nearest-neighbor ranking. candidate_for_race/race_for_rating stay as constant 1 so existing
-- queries (.eq("candidate_for_race", 1).eq("race_for_rating", 1)) keep working unchanged.
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
        )
 SELECT "r"."session_id",
    "r"."driver_id",
    "r"."garage61_event_id",
    "r"."rating_category",
    "r"."car_class",
    "r"."car",
    "r"."track",
    "r"."started_at",
    "r"."ended_at",
    "m"."rating_at",
    "m"."previous_rating",
    "m"."new_rating",
    "m"."delta_irating",
    (EXTRACT(epoch FROM ("m"."rating_at" - "r"."ended_at")) / 60.0) AS "minutes_after_race",
    1::bigint AS "candidate_for_race",
    1::bigint AS "race_for_rating"
   FROM ("races" "r"
     JOIN "public"."race_rating_matches" "m" ON (("m"."session_id" = "r"."session_id")));

ALTER VIEW "public"."v_race_irating_candidates" OWNER TO "postgres";
