# Exemplo de JSON de corrida (iRacing `event_result`)

Fonte: `Downloads\eventresult-89199619.json` (export oficial "Download JSON" do iRacing UI), subsessão **89199619**. Nomes, `cust_id` e aparência de pilotos estão mascarados (`<mascarado>`); a amostra mostra só 2 resultados por sessão e até 3 itens por lista.

## Estrutura geral

- Envelope: `{ type: "event_result", data: {…} }`. O agente só coleta arquivos com `type == "event_result"`.
- Campos distintos (caminhos): **211**; o `ResultReducer.cs` remove cerca de **65** (aparência, liga, CPI, `license_change_*`, clima detalhado, IA etc.) antes de enviar. A coluna *Envio* é uma heurística por nome do campo, não a lista oficial.
- `data.session_results[]`: uma entrada por sessão do evento. Neste arquivo: `simsession_type=3` Open Practice (20 resultados); `simsession_type=4` Lone Qualifying (20 resultados); `simsession_type=6` Race (20 resultados). O agente mantém só Practice/Qualify/Race (`simsession_type` 3/4/6).
- Cada item de `results[]` traz posição, classe, voltas, incidentes, melhor volta/média, `oldi_rating`/`newi_rating`, licença antes/depois, `reason_out` e `laps_lead`.

## Chaves de `data` (nível 1)

`subsession_id`, `allowed_licenses`, `associated_subsession_ids`, `can_protest`, `car_classes`, `caution_type`, `cooldown_minutes`, `corners_per_lap`, `damage_model`, `driver_change_param1`, `driver_change_param2`, `driver_change_rule`, `driver_changes`, `end_time`, `event_average_lap`, `event_best_lap_time`, `event_laps_complete`, `event_strength_of_field`, `event_type`, `event_type_name`, `heat_info_id`, `license_category`, `license_category_id`, `limit_minutes`, `max_team_drivers`, `max_weeks`, `min_team_drivers`, `num_caution_laps`, `num_cautions`, `num_drivers`, `num_laps_for_qual_average`, `num_laps_for_solo_average`, `num_lead_changes`, `official_session`, `points_type`, `private_session_id`, `race_summary`, `race_week_num`, `results_restricted`, `season_id`, `season_name`, `season_quarter`, `season_short_name`, `season_year`, `series_id`, `series_logo`, `series_name`, `series_short_name`, `session_id`, `session_results`, `session_splits`, `special_event_type`, `start_time`, `track`, `track_state`, `weather`

## Amostra reduzida (mascarada)

```json
{
 "type": "event_result",
 "data": {
  "subsession_id": 89199619,
  "allowed_licenses": [
   {
    "group_name": "Class C",
    "license_group": 3,
    "max_license_level": 12,
    "min_license_level": 12,
    "parent_id": 444
   },
   {
    "group_name": "Class B",
    "license_group": 4,
    "max_license_level": 16,
    "min_license_level": 13,
    "parent_id": 444
   },
   {
    "group_name": "Class A",
    "license_group": 5,
    "max_license_level": 20,
    "min_license_level": 17,
    "parent_id": 444
   },
   {
    "group_name": "Pro",
    "license_group": 6,
    "max_license_level": 24,
    "min_license_level": 21,
    "parent_id": 444
   },
   {
    "group_name": "Pro/WC",
    "license_group": 7,
    "max_license_level": 28,
    "min_license_level": 25,
    "parent_id": 444
   }
  ],
  "associated_subsession_ids": [
   89199619,
   89199620,
   89199621
  ],
  "can_protest": true,
  "car_classes": [
   {
    "car_class_id": 2708,
    "short_name": "GT3 Class",
    "name": "GT3 Class",
    "strength_of_field": 3084,
    "num_entries": 20,
    "cars_in_class": [
     {
      "car_id": 176
     },
     {
      "car_id": 132
     },
     {
      "car_id": 184
     },
     {
      "car_id": 169
     },
     {
      "car_id": 156
     },
     {
      "car_id": 173
     },
     {
      "car_id": 206
     }
    ]
   }
  ],
  "caution_type": 2,
  "cooldown_minutes": 30,
  "corners_per_lap": 14,
  "damage_model": 0,
  "driver_change_param1": -1,
  "driver_change_param2": -1,
  "driver_change_rule": 0,
  "driver_changes": false,
  "end_time": "2026-10-07T21:50:37Z",
  "event_average_lap": 1099926,
  "event_best_lap_time": 1093963,
  "event_laps_complete": 11,
  "event_strength_of_field": 3092,
  "event_type": 5,
  "event_type_name": "Race",
  "heat_info_id": -1,
  "license_category": "Sports_Car",
  "license_category_id": 5,
  "limit_minutes": 10080,
  "max_team_drivers": 1,
  "max_weeks": 12,
  "min_team_drivers": 1,
  "num_caution_laps": 0,
  "num_cautions": 0,
  "num_drivers": 20,
  "num_laps_for_qual_average": 2,
  "num_laps_for_solo_average": 4,
  "num_lead_changes": 0,
  "official_session": true,
  "points_type": "race",
  "private_session_id": -1,
  "race_summary": {
   "subsession_id": 89199619,
   "average_lap": 1099926,
   "laps_complete": 11,
   "num_cautions": 0,
   "num_caution_laps": 0,
   "num_lead_changes": 0,
   "field_strength": 3092,
   "num_opt_laps": 0,
   "has_opt_path": false,
   "special_event_type": 0,
   "special_event_type_text": "Not a special event"
  },
  "race_week_num": 3,
  "results_restricted": false,
  "season_id": 6478,
  "season_name": "GT3 Challenge Fixed by Fanatec - 2026 Season 4",
  "season_quarter": 4,
  "season_short_name": "2026 Season 4 - Fixed",
  "season_year": 2026,
  "series_id": 444,
  "series_logo": "fanatecgt3challenge-logo.png",
  "series_name": "GT3 Challenge Fixed by Fanatec",
  "series_short_name": "GT3 Challenge Fixed by Fanatec",
  "session_id": 323937398,
  "session_results": [
   {
    "simsession_number": -2,
    "simsession_name": "PRACTICE",
    "simsession_type": 3,
    "simsession_type_name": "Open Practice",
    "simsession_subtype": 0,
    "weather_result": {
     "avg_skies": 2,
     "avg_cloud_cover_pct": 55.567455,
     "min_cloud_cover_pct": 55.567455,
     "max_cloud_cover_pct": 55.567455,
     "temp_units": 1,
     "avg_temp": 26.473122,
     "min_temp": 26.473122,
     "max_temp": 26.473122,
     "avg_rel_humidity": 22.913149,
     "wind_units": 1,
     "avg_wind_speed": 1.8000001,
     "min_wind_speed": 1.8000001,
     "max_wind_speed": 1.8000001,
     "avg_wind_dir": 7,
     "max_fog": 0,
     "fog_time_pct": 0,
     "precip_time_pct": 0,
     "precip_mm": 0,
     "precip_mm2hr_before_session": 0,
     "simulated_start_time": "2026-10-10T11:30:00"
    },
    "results": [
     {
      "cust_id": "<mascarado>",
      "display_name": "<mascarado>",
      "aggregate_champ_points": 185,
      "ai": false,
      "average_lap": 1166547,
      "best_lap_num": -1,
      "best_lap_time": -1,
      "best_nlaps_num": -1,
      "best_nlaps_time": -1,
      "best_qual_lap_at": "1970-01-01T00:00:00Z",
      "best_qual_lap_num": -1,
      "best_qual_lap_time": -1,
      "car_class_id": 2708,
      "car_class_name": "GT3 Class",
      "car_class_short_name": "GT3 Class",
      "car_id": 169,
      "car_name": "Porsche 911 GT3 R (992)",
      "carcfg": -1,
      "champ_points": 0,
      "class_interval": 0,
      "country_code": "GR",
      "division": 0,
      "division_name": "Division 1",
      "drop_race": false,
      "finish_position": 0,
      "finish_position_in_class": 0,
      "flair_id": 80,
      "flair_name": "Greece",
      "flair_shortname": "GRC",
      "friend": false,
      "helmet": {
       "pattern": 5,
       "color1": "c0c0c0",
       "color2": "f00000",
       "color3": "000000",
       "face_type": 0,
       "helmet_type": 0
      },
      "incidents": 0,
      "interval": 0,
      "laps_complete": 1,
      "laps_lead": 0,
      "league_agg_points": 0,
      "league_points": 0,
      "license_change_oval": -1,
      "license_change_road": -1,
      "livery": {
       "car_id": 169,
       "pattern": 14,
       "color1": "000000",
       "color2": "000000",
       "color3": "000000",
       "number_font": 0,
       "number_color1": "FFFFFF",
       "number_color2": "777777",
       "number_color3": "000000",
       "number_slant": 0,
       "sponsor1": 0,
       "sponsor2": 0,
       "car_number": "1",
       "wheel_color": null,
       "rim_type": -1
      },
      "max_pct_fuel_fill": 50,
      "new_cpi": 55.11957,
      "new_license_level": 19,
      "new_sub_level": 320,
      "new_ttrating": 1350,
      "newi_rating": 7309,
      "old_cpi": 53.296947,
      "old_license_level": 19,
      "old_sub_level": 315,
      "old_ttrating": 1350,
      "oldi_rating": 7286,
      "opt_laps_complete": 0,
      "position": 0,
      "qual_lap_time": -1,
      "reason_out": "Running",
      "reason_out_id": 0,
      "starting_position": -1,
      "starting_position_in_class": -1,
      "suit": {
       "pattern": 0,
       "color1": "000000",
       "color2": "000000",
       "color3": "000000"
      },
      "watched": false,
      "weight_penalty_kg": -1
     },
     {
      "cust_id": "<mascarado>",
      "display_name": "<mascarado>",
      "aggregate_champ_points": 126,
      "ai": false,
      "average_lap": 0,
      "best_lap_num": -1,
      "best_lap_time": -1,
      "best_nlaps_num": -1,
      "best_nlaps_time": -1,
      "best_qual_lap_at": "1970-01-01T00:00:00Z",
      "best_qual_lap_num": -1,
      "best_qual_lap_time": -1,
      "car_class_id": 2708,
      "car_class_name": "GT3 Class",
      "car_class_short_name": "GT3 Class",
      "car_id": 184,
      "car_name": "Chevrolet Corvette Z06 GT3.R",
      "carcfg": -1,
      "champ_points": 0,
      "class_interval": -1,
      "country_code": "PT",
      "division": 0,
      "division_name": "Division 1",
      "drop_race": false,
      "finish_position": 1,
      "finish_position_in_class": 1,
      "flair_id": 168,
      "flair_name": "Portugal",
      "flair_shortname": "PRT",
      "friend": false,
      "helmet": {
       "pattern": 58,
       "color1": "211e1f",
       "color2": "ebecf1",
       "color3": "79af08",
       "face_type": 0,
       "helmet_type": 0
      },
      "incidents": 0,
      "interval": -1,
      "laps_complete": 0,
      "laps_lead": 0,
      "league_agg_points": 0,
      "league_points": 0,
      "license_change_oval": -1,
      "license_change_road": -1,
      "livery": {
       "car_id": 184,
       "pattern": 7,
       "color1": "211e1f",
       "color2": "ebecf1",
       "color3": "79af08",
       "number_font": 0,
       "number_color1": "ffffff",
       "number_color2": "777777",
       "number_color3": "000000",
       "number_slant": 0,
       "sponsor1": 0,
       "sponsor2": 0,
       "car_number": "2",
       "wheel_color": "000000",
       "rim_type": 0
      },
      "max_pct_fuel_fill": 50,
      "new_cpi": 69.38383,
      "new_license_level": 19,
      "new_sub_level": 355,
      "new_ttrating": 1350,
      "newi_rating": 6007,
      "old_cpi": 81.74537,
      "old_license_level": 20,
      "old_sub_level": 421,
      "old_ttrating": 1350,
      "oldi_rating": 6027,
      "opt_laps_complete": 0,
      "position": 1,
      "qual_lap_time": -1,
      "reason_out": "Running",
      "reason_out_id": 0,
      "starting_position": -1,
      "starting_position_in_class": -1,
      "suit": {
       "pattern": 3,
       "color1": "141313",
       "color2": "efe7e7",
       "color3": "020202"
      },
      "watched": false,
      "weight_penalty_kg": -1
     }
    ]
   },
   {
    "simsession_number": -1,
    "simsession_name": "QUALIFY",
    "simsession_type": 4,
    "simsession_type_name": "Lone Qualifying",
    "simsession_subtype": 0,
    "weather_result": {
     "avg_skies": 2,
     "avg_cloud_cover_pct": 57.552563,
     "min_cloud_cover_pct": 57.552563,
     "max_cloud_cover_pct": 57.552563,
     "temp_units": 1,
     "avg_temp": 26.890377,
     "min_temp": 26.890377,
     "max_temp": 26.890377,
     "avg_rel_humidity": 22.322908,
     "wind_units": 1,
     "avg_wind_speed": 1.8000001,
     "min_wind_speed": 1.8000001,
     "max_wind_speed": 1.8000001,
     "avg_wind_dir": 7,
     "max_fog": 0,
     "fog_time_pct": 0,
     "precip_time_pct": 0,
     "precip_mm": 0,
     "precip_mm2hr_before_session": 0,
     "simulated_start_time": "2026-10-10T11:45:00"
    },
    "results": [
     {
      "cust_id": "<mascarado>",
      "display_name": "<mascarado>",
      "aggregate_champ_points": 185,
      "ai": false,
      "average_lap": 1097129,
      "best_lap_num": 2,
      "best_lap_time": 1094890,
      "best_nlaps_num": -1,
      "best_nlaps_time": -1,
      "best_qual_lap_at": "2026-10-07T21:21:04Z",
      "best_qual_lap_num": 2,
      "best_qual_lap_time": 1094890,
      "car_class_id": 2708,
      "car_class_name": "GT3 Class",
      "car_class_short_name": "GT3 Class",
      "car_id": 169,
      "car_name": "Porsche 911 GT3 R (992)",
      "carcfg": -1,
      "champ_points": 0,
      "class_interval": 0,
      "country_code": "GR",
      "division": 0,
      "division_name": "Division 1",
      "drop_race": false,
      "finish_position": 0,
      "finish_position_in_class": 0,
      "flair_id": 80,
      "flair_name": "Greece",
      "flair_shortname": "GRC",
      "friend": false,
      "helmet": {
       "pattern": 5,
       "color1": "c0c0c0",
       "color2": "f00000",
       "color3": "000000",
       "face_type": 0,
       "helmet_type": 0
      },
      "incidents": 0,
      "interval": 0,
      "laps_complete": 2,
      "laps_lead": 0,
      "league_agg_points": 0,
      "league_points": 0,
      "license_change_oval": -1,
      "license_change_road": -1,
      "livery": {
       "car_id": 169,
       "pattern": 14,
       "color1": "000000",
       "color2": "000000",
       "color3": "000000",
       "number_font": 0,
       "number_color1": "FFFFFF",
       "number_color2": "777777",
       "number_color3": "000000",
       "number_slant": 0,
       "sponsor1": 0,
       "sponsor2": 0,
       "car_number": "1",
       "wheel_color": null,
       "rim_type": -1
      },
      "max_pct_fuel_fill": 50,
      "new_cpi": 55.11957,
      "new_license_level": 19,
      "new_sub_level": 320,
      "new_ttrating": 1350,
      "newi_rating": 7309,
      "old_cpi": 53.296947,
      "old_license_level": 19,
      "old_sub_level": 315,
      "old_ttrating": 1350,
      "oldi_rating": 7286,
      "opt_laps_complete": 0,
      "position": 0,
      "qual_lap_time": -1,
      "reason_out": "Running",
      "reason_out_id": 0,
      "starting_position": -1,
      "starting_position_in_class": -1,
      "suit": {
       "pattern": 0,
       "color1": "000000",
       "color2": "000000",
       "color3": "000000"
      },
      "watched": false,
      "weight_penalty_kg": -1
     },
     {
      "cust_id": "<mascarado>",
      "display_name": "<mascarado>",
      "aggregate_champ_points": 175,
      "ai": false,
      "average_lap": 1098636,
      "best_lap_num": 2,
      "best_lap_time": 1097186,
      "best_nlaps_num": -1,
      "best_nlaps_time": -1,
      "best_qual_lap_at": "2026-10-07T21:21:13Z",
      "best_qual_lap_num": 2,
      "best_qual_lap_time": 1097186,
      "car_class_id": 2708,
      "car_class_name": "GT3 Class",
      "car_class_short_name": "GT3 Class",
      "car_id": 184,
      "car_name": "Chevrolet Corvette Z06 GT3.R",
      "carcfg": -1,
      "champ_points": 0,
      "class_interval": 2296,
      "country_code": "US",
      "division": 0,
      "division_name": "Division 1",
      "drop_race": false,
      "finish_position": 1,
      "finish_position_in_class": 1,
      "flair_id": 223,
      "flair_name": "United States",
      "flair_shortname": "USA",
      "friend": false,
      "helmet": {
       "pattern": 9,
       "color1": "ff0000",
       "color2": "ffffff",
       "color3": "000000",
       "face_type": 0,
       "helmet_type": 0
      },
      "incidents": 0,
      "interval": 2296,
      "laps_complete": 2,
      "laps_lead": 0,
      "league_agg_points": 0,
      "league_points": 0,
      "license_change_oval": -1,
      "license_change_road": -1,
      "livery": {
       "car_id": 184,
       "pattern": 0,
       "color1": "2a3795",
       "color2": "ed2129",
       "color3": "ffffff",
       "number_font": 0,
       "number_color1": "ffffff",
       "number_color2": "777777",
       "number_color3": "000000",
       "number_slant": 0,
       "sponsor1": 0,
       "sponsor2": 0,
       "car_number": "3",
       "wheel_color": null,
       "rim_type": -1
      },
      "max_pct_fuel_fill": 50,
      "new_cpi": 64.20399,
      "new_license_level": 19,
      "new_sub_level": 343,
      "new_ttrating": 1350,
      "newi_rating": 5516,
      "old_cpi": 60.95381,
      "old_license_level": 19,
      "old_sub_level": 336,
      "old_ttrating": 1350,
      "oldi_rating": 5479,
      "opt_laps_complete": 0,
      "position": 1,
      "qual_lap_time": -1,
      "reason_out": "Running",
      "reason_out_id": 0,
      "starting_position": -1,
      "starting_position_in_class": -1,
      "suit": {
       "pattern": 11,
       "color1": "ffffff",
       "color2": "ff0000",
       "color3": "000000"
      },
      "watched": false,
      "weight_penalty_kg": -1
     }
    ]
   },
   {
    "simsession_number": 0,
    "simsession_name": "RACE",
    "simsession_type": 6,
    "simsession_type_name": "Race",
    "simsession_subtype": 0,
    "weather_result": {
     "avg_skies": 2,
     "avg_cloud_cover_pct": 55.48651,
     "min_cloud_cover_pct": 54.565365,
     "max_cloud_cover_pct": 56.57,
     "temp_units": 1,
     "avg_temp": 27.032953,
     "min_temp": 26.927496,
     "max_temp": 27.146872,
     "avg_rel_humidity": 21.505644,
     "wind_units": 1,
     "avg_wind_speed": 1.8000001,
     "min_wind_speed": 1.8000001,
     "max_wind_speed": 1.8000001,
     "avg_wind_dir": 7,
     "max_fog": 0,
     "fog_time_pct": 0,
     "precip_time_pct": 0,
     "precip_mm": 0,
     "precip_mm2hr_before_session": 0,
     "simulated_start_time": "2026-10-10T12:05:00"
    },
    "results": [
     {
      "cust_id": "<mascarado>",
      "display_name": "<mascarado>",
      "aggregate_champ_points": 185,
      "ai": false,
      "average_lap": 1099926,
      "best_lap_num": 5,
      "best_lap_time": 1093963,
      "best_nlaps_num": -1,
      "best_nlaps_time": -1,
      "best_qual_lap_at": "1970-01-01T00:00:00Z",
      "best_qual_lap_num": -1,
      "best_qual_lap_time": -1,
      "car_class_id": 2708,
      "car_class_name": "GT3 Class",
      "car_class_short_name": "GT3 Class",
      "car_id": 169,
      "car_name": "Porsche 911 GT3 R (992)",
      "carcfg": -1,
      "champ_points": 185,
      "class_interval": 0,
      "country_code": "GR",
      "division": 0,
      "division_name": "Division 1",
      "drop_race": false,
      "finish_position": 0,
      "finish_position_in_class": 0,
      "flair_id": 80,
      "flair_name": "Greece",
      "flair_shortname": "GRC",
      "friend": false,
      "helmet": {
       "pattern": 5,
       "color1": "c0c0c0",
       "color2": "f00000",
       "color3": "000000",
       "face_type": 0,
       "helmet_type": 0
      },
      "incidents": 2,
      "interval": 0,
      "laps_complete": 11,
      "laps_lead": 11,
      "league_agg_points": 0,
      "league_points": 0,
      "license_change_oval": -1,
      "license_change_road": -1,
      "livery": {
       "car_id": 169,
       "pattern": 14,
       "color1": "000000",
       "color2": "000000",
       "color3": "000000",
       "number_font": 0,
       "number_color1": "FFFFFF",
       "number_color2": "777777",
       "number_color3": "000000",
       "number_slant": 0,
       "sponsor1": 0,
       "sponsor2": 0,
       "car_number": "1",
       "wheel_color": null,
       "rim_type": -1
      },
      "max_pct_fuel_fill": 50,
      "new_cpi": 55.11957,
      "new_license_level": 19,
      "new_sub_level": 320,
      "new_ttrating": 1350,
      "newi_rating": 7309,
      "old_cpi": 53.296947,
      "old_license_level": 19,
      "old_sub_level": 315,
      "old_ttrating": 1350,
      "oldi_rating": 7286,
      "opt_laps_complete": 0,
      "position": 0,
      "qual_lap_time": -1,
      "reason_out": "Running",
      "reason_out_id": 0,
      "starting_position": 0,
      "starting_position_in_class": 0,
      "suit": {
       "pattern": 0,
       "color1": "000000",
       "color2": "000000",
       "color3": "000000"
      },
      "watched": false,
      "weight_penalty_kg": -1
     },
     {
      "cust_id": "<mascarado>",
      "display_name": "<mascarado>",
      "aggregate_champ_points": 175,
      "ai": false,
      "average_lap": 1103498,
      "best_lap_num": 4,
      "best_lap_time": 1096020,
      "best_nlaps_num": -1,
      "best_nlaps_time": -1,
      "best_qual_lap_at": "1970-01-01T00:00:00Z",
      "best_qual_lap_num": -1,
      "best_qual_lap_time": -1,
      "car_class_id": 2708,
      "car_class_name": "GT3 Class",
      "car_class_short_name": "GT3 Class",
      "car_id": 184,
      "car_name": "Chevrolet Corvette Z06 GT3.R",
      "carcfg": -1,
      "champ_points": 175,
      "class_interval": 39299,
      "country_code": "US",
      "division": 0,
      "division_name": "Division 1",
      "drop_race": false,
      "finish_position": 1,
      "finish_position_in_class": 1,
      "flair_id": 223,
      "flair_name": "United States",
      "flair_shortname": "USA",
      "friend": false,
      "helmet": {
       "pattern": 9,
       "color1": "ff0000",
       "color2": "ffffff",
       "color3": "000000",
       "face_type": 0,
       "helmet_type": 0
      },
      "incidents": 1,
      "interval": 39299,
      "laps_complete": 11,
      "laps_lead": 0,
      "league_agg_points": 0,
      "league_points": 0,
      "license_change_oval": -1,
      "license_change_road": -1,
      "livery": {
       "car_id": 184,
       "pattern": 0,
       "color1": "2a3795",
       "color2": "ed2129",
       "color3": "ffffff",
       "number_font": 0,
       "number_color1": "ffffff",
       "number_color2": "777777",
       "number_color3": "000000",
       "number_slant": 0,
       "sponsor1": 0,
       "sponsor2": 0,
       "car_number": "3",
       "wheel_color": null,
       "rim_type": -1
      },
      "max_pct_fuel_fill": 50,
      "new_cpi": 64.20399,
      "new_license_level": 19,
      "new_sub_level": 343,
      "new_ttrating": 1350,
      "newi_rating": 5516,
      "old_cpi": 60.95381,
      "old_license_level": 19,
      "old_sub_level": 336,
      "old_ttrating": 1350,
      "oldi_rating": 5479,
      "opt_laps_complete": 0,
      "position": 1,
      "qual_lap_time": -1,
      "reason_out": "Running",
      "reason_out_id": 0,
      "starting_position": 1,
      "starting_position_in_class": 1,
      "suit": {
       "pattern": 11,
       "color1": "ffffff",
       "color2": "ff0000",
       "color3": "000000"
      },
      "watched": false,
      "weight_penalty_kg": -1
     }
    ]
   }
  ],
  "session_splits": [
   {
    "subsession_id": 89199619,
    "event_strength_of_field": 3092
   },
   {
    "subsession_id": 89199620,
    "event_strength_of_field": 1835
   },
   {
    "subsession_id": 89199621,
    "event_strength_of_field": 1175
   }
  ],
  "special_event_type": -1,
  "start_time": "2026-10-07T21:15:00Z",
  "track": {
   "category": "Road",
   "category_id": 2,
   "config_name": "Grand Prix",
   "track_id": 195,
   "track_name": "Mobility Resort Motegi"
  },
  "track_state": {
   "leave_marbles": true,
   "practice_rubber": -1,
   "qualify_rubber": -1,
   "race_rubber": -1,
   "warmup_rubber": -1
  },
  "weather": {
   "allow_fog": false,
   "fog": 0,
   "precip_mm2hr_before_final_session": 0,
   "precip_mm_final_session": 0,
   "precip_option": 8,
   "precip_time_pct": 0,
   "rel_humidity": 0,
   "simulated_start_time": "2026-10-10T11:30:00",
   "skies": 2,
   "temp_units": 1,
   "temp_value": 26,
   "time_of_day": 1,
   "track_water": 0,
   "type": 3,
   "version": 1,
   "weather_var_initial": 0,
   "weather_var_ongoing": 0,
   "wind_dir": 7,
   "wind_units": 1,
   "wind_value": 0
  }
 }
}
```

## Todos os campos (caminho, tipo, exemplo, envio)

| Caminho | Tipo | Exemplo | Envio |
|---|---|---|---|
| `type` | str | `"event_result"` | mantido |
| `data.subsession_id` | int | `89199619` | mantido |
| `data.allowed_licenses[].group_name` | str | `"Class C"` | removido |
| `data.allowed_licenses[].license_group` | int | `3` | removido |
| `data.allowed_licenses[].max_license_level` | int | `12` | removido |
| `data.allowed_licenses[].min_license_level` | int | `12` | removido |
| `data.allowed_licenses[].parent_id` | int | `444` | removido |
| `data.associated_subsession_ids[]` | int | `89199619` | mantido |
| `data.can_protest` | bool | `true` | mantido |
| `data.car_classes[].car_class_id` | int | `2708` | mantido |
| `data.car_classes[].short_name` | str | `"GT3 Class"` | mantido |
| `data.car_classes[].name` | str | `"GT3 Class"` | mantido |
| `data.car_classes[].strength_of_field` | int | `3084` | mantido |
| `data.car_classes[].num_entries` | int | `20` | mantido |
| `data.car_classes[].cars_in_class[].car_id` | int | `176` | mantido |
| `data.caution_type` | int | `2` | mantido |
| `data.cooldown_minutes` | int | `30` | mantido |
| `data.corners_per_lap` | int | `14` | mantido |
| `data.damage_model` | int | `0` | mantido |
| `data.driver_change_param1` | int | `-1` | mantido |
| `data.driver_change_param2` | int | `-1` | mantido |
| `data.driver_change_rule` | int | `0` | mantido |
| `data.driver_changes` | bool | `false` | mantido |
| `data.end_time` | str | `"2026-10-07T21:50:37Z"` | mantido |
| `data.event_average_lap` | int | `1099926` | mantido |
| `data.event_best_lap_time` | int | `1093963` | mantido |
| `data.event_laps_complete` | int | `11` | mantido |
| `data.event_strength_of_field` | int | `3092` | mantido |
| `data.event_type` | int | `5` | mantido |
| `data.event_type_name` | str | `"Race"` | mantido |
| `data.heat_info_id` | int | `-1` | mantido |
| `data.license_category` | str | `"Sports_Car"` | mantido |
| `data.license_category_id` | int | `5` | mantido |
| `data.limit_minutes` | int | `10080` | mantido |
| `data.max_team_drivers` | int | `1` | mantido |
| `data.max_weeks` | int | `12` | mantido |
| `data.min_team_drivers` | int | `1` | mantido |
| `data.num_caution_laps` | int | `0` | mantido |
| `data.num_cautions` | int | `0` | mantido |
| `data.num_drivers` | int | `20` | mantido |
| `data.num_laps_for_qual_average` | int | `2` | mantido |
| `data.num_laps_for_solo_average` | int | `4` | mantido |
| `data.num_lead_changes` | int | `0` | mantido |
| `data.official_session` | bool | `true` | mantido |
| `data.points_type` | str | `"race"` | mantido |
| `data.private_session_id` | int | `-1` | mantido |
| `data.race_summary.subsession_id` | int | `89199619` | mantido |
| `data.race_summary.average_lap` | int | `1099926` | mantido |
| `data.race_summary.laps_complete` | int | `11` | mantido |
| `data.race_summary.num_cautions` | int | `0` | mantido |
| `data.race_summary.num_caution_laps` | int | `0` | mantido |
| `data.race_summary.num_lead_changes` | int | `0` | mantido |
| `data.race_summary.field_strength` | int | `3092` | mantido |
| `data.race_summary.num_opt_laps` | int | `0` | mantido |
| `data.race_summary.has_opt_path` | bool | `false` | mantido |
| `data.race_summary.special_event_type` | int | `0` | mantido |
| `data.race_summary.special_event_type_text` | str | `"Not a special event"` | mantido |
| `data.race_week_num` | int | `3` | mantido |
| `data.results_restricted` | bool | `false` | mantido |
| `data.season_id` | int | `6478` | mantido |
| `data.season_name` | str | `"GT3 Challenge Fixed by Fanatec - 2026 Season 4"` | mantido |
| `data.season_quarter` | int | `4` | mantido |
| `data.season_short_name` | str | `"2026 Season 4 - Fixed"` | mantido |
| `data.season_year` | int | `2026` | mantido |
| `data.series_id` | int | `444` | mantido |
| `data.series_logo` | str | `"fanatecgt3challenge-logo.png"` | removido |
| `data.series_name` | str | `"GT3 Challenge Fixed by Fanatec"` | mantido |
| `data.series_short_name` | str | `"GT3 Challenge Fixed by Fanatec"` | mantido |
| `data.session_id` | int | `323937398` | mantido |
| `data.session_results[].simsession_number` | int | `-2` | mantido |
| `data.session_results[].simsession_name` | str | `"PRACTICE"` | mantido |
| `data.session_results[].simsession_type` | int | `3` | mantido |
| `data.session_results[].simsession_type_name` | str | `"Open Practice"` | mantido |
| `data.session_results[].simsession_subtype` | int | `0` | mantido |
| `data.session_results[].weather_result.avg_skies` | int | `2` | removido |
| `data.session_results[].weather_result.avg_cloud_cover_pct` | float | `55.567455` | removido |
| `data.session_results[].weather_result.min_cloud_cover_pct` | float | `55.567455` | removido |
| `data.session_results[].weather_result.max_cloud_cover_pct` | float | `55.567455` | removido |
| `data.session_results[].weather_result.temp_units` | int | `1` | removido |
| `data.session_results[].weather_result.avg_temp` | float | `26.473122` | removido |
| `data.session_results[].weather_result.min_temp` | float | `26.473122` | removido |
| `data.session_results[].weather_result.max_temp` | float | `26.473122` | removido |
| `data.session_results[].weather_result.avg_rel_humidity` | float | `22.913149` | removido |
| `data.session_results[].weather_result.wind_units` | int | `1` | removido |
| `data.session_results[].weather_result.avg_wind_speed` | float | `1.8000001` | removido |
| `data.session_results[].weather_result.min_wind_speed` | float | `1.8000001` | removido |
| `data.session_results[].weather_result.max_wind_speed` | float | `1.8000001` | removido |
| `data.session_results[].weather_result.avg_wind_dir` | int | `7` | removido |
| `data.session_results[].weather_result.max_fog` | int | `0` | removido |
| `data.session_results[].weather_result.fog_time_pct` | int | `0` | removido |
| `data.session_results[].weather_result.precip_time_pct` | int | `0` | removido |
| `data.session_results[].weather_result.precip_mm` | int | `0` | removido |
| `data.session_results[].weather_result.precip_mm2hr_before_session` | int | `0` | removido |
| `data.session_results[].weather_result.simulated_start_time` | str | `"2026-10-10T11:30:00"` | removido |
| `data.session_results[].results[].cust_id` | int | `"<mascarado>"` | mantido |
| `data.session_results[].results[].display_name` | str | `"<mascarado>"` | mantido |
| `data.session_results[].results[].aggregate_champ_points` | int | `185` | removido |
| `data.session_results[].results[].ai` | bool | `false` | mantido |
| `data.session_results[].results[].average_lap` | int | `1166547` | mantido |
| `data.session_results[].results[].best_lap_num` | int | `-1` | mantido |
| `data.session_results[].results[].best_lap_time` | int | `-1` | mantido |
| `data.session_results[].results[].best_nlaps_num` | int | `-1` | mantido |
| `data.session_results[].results[].best_nlaps_time` | int | `-1` | mantido |
| `data.session_results[].results[].best_qual_lap_at` | str | `"1970-01-01T00:00:00Z"` | mantido |
| `data.session_results[].results[].best_qual_lap_num` | int | `-1` | mantido |
| `data.session_results[].results[].best_qual_lap_time` | int | `-1` | mantido |
| `data.session_results[].results[].car_class_id` | int | `2708` | mantido |
| `data.session_results[].results[].car_class_name` | str | `"GT3 Class"` | mantido |
| `data.session_results[].results[].car_class_short_name` | str | `"GT3 Class"` | mantido |
| `data.session_results[].results[].car_id` | int | `169` | mantido |
| `data.session_results[].results[].car_name` | str | `"Porsche 911 GT3 R (992)"` | mantido |
| `data.session_results[].results[].carcfg` | int | `-1` | removido |
| `data.session_results[].results[].champ_points` | int | `0` | removido |
| `data.session_results[].results[].class_interval` | int | `0` | mantido |
| `data.session_results[].results[].country_code` | str | `"GR"` | mantido |
| `data.session_results[].results[].division` | int | `0` | mantido |
| `data.session_results[].results[].division_name` | str | `"Division 1"` | mantido |
| `data.session_results[].results[].drop_race` | bool | `false` | mantido |
| `data.session_results[].results[].finish_position` | int | `0` | mantido |
| `data.session_results[].results[].finish_position_in_class` | int | `0` | mantido |
| `data.session_results[].results[].flair_id` | int | `80` | removido |
| `data.session_results[].results[].flair_name` | str | `"Greece"` | removido |
| `data.session_results[].results[].flair_shortname` | str | `"GRC"` | removido |
| `data.session_results[].results[].friend` | bool | `false` | removido |
| `data.session_results[].results[].helmet.pattern` | int | `5` | removido |
| `data.session_results[].results[].helmet.color1` | str | `"c0c0c0"` | removido |
| `data.session_results[].results[].helmet.color2` | str | `"f00000"` | removido |
| `data.session_results[].results[].helmet.color3` | str | `"000000"` | removido |
| `data.session_results[].results[].helmet.face_type` | int | `0` | removido |
| `data.session_results[].results[].helmet.helmet_type` | int | `0` | removido |
| `data.session_results[].results[].incidents` | int | `0` | mantido |
| `data.session_results[].results[].interval` | int | `0` | mantido |
| `data.session_results[].results[].laps_complete` | int | `1` | mantido |
| `data.session_results[].results[].laps_lead` | int | `0` | mantido |
| `data.session_results[].results[].league_agg_points` | int | `0` | removido |
| `data.session_results[].results[].league_points` | int | `0` | removido |
| `data.session_results[].results[].license_change_oval` | int | `-1` | removido |
| `data.session_results[].results[].license_change_road` | int | `-1` | removido |
| `data.session_results[].results[].livery.car_id` | int | `169` | removido |
| `data.session_results[].results[].livery.pattern` | int | `14` | removido |
| `data.session_results[].results[].livery.color1` | str | `"000000"` | removido |
| `data.session_results[].results[].livery.color2` | str | `"000000"` | removido |
| `data.session_results[].results[].livery.color3` | str | `"000000"` | removido |
| `data.session_results[].results[].livery.number_font` | int | `0` | removido |
| `data.session_results[].results[].livery.number_color1` | str | `"FFFFFF"` | removido |
| `data.session_results[].results[].livery.number_color2` | str | `"777777"` | removido |
| `data.session_results[].results[].livery.number_color3` | str | `"000000"` | removido |
| `data.session_results[].results[].livery.number_slant` | int | `0` | removido |
| `data.session_results[].results[].livery.sponsor1` | int | `0` | removido |
| `data.session_results[].results[].livery.sponsor2` | int | `0` | removido |
| `data.session_results[].results[].livery.car_number` | str | `"1"` | removido |
| `data.session_results[].results[].livery.wheel_color` | NoneType/str | `"000000"` | removido |
| `data.session_results[].results[].livery.rim_type` | int | `-1` | removido |
| `data.session_results[].results[].max_pct_fuel_fill` | int | `50` | mantido |
| `data.session_results[].results[].new_cpi` | float | `55.11957` | removido |
| `data.session_results[].results[].new_license_level` | int | `19` | mantido |
| `data.session_results[].results[].new_sub_level` | int | `320` | mantido |
| `data.session_results[].results[].new_ttrating` | int | `1350` | mantido |
| `data.session_results[].results[].newi_rating` | int | `7309` | mantido |
| `data.session_results[].results[].old_cpi` | float | `53.296947` | removido |
| `data.session_results[].results[].old_license_level` | int | `19` | mantido |
| `data.session_results[].results[].old_sub_level` | int | `315` | mantido |
| `data.session_results[].results[].old_ttrating` | int | `1350` | mantido |
| `data.session_results[].results[].oldi_rating` | int | `7286` | mantido |
| `data.session_results[].results[].opt_laps_complete` | int | `0` | mantido |
| `data.session_results[].results[].position` | int | `0` | mantido |
| `data.session_results[].results[].qual_lap_time` | int | `-1` | mantido |
| `data.session_results[].results[].reason_out` | str | `"Running"` | mantido |
| `data.session_results[].results[].reason_out_id` | int | `0` | mantido |
| `data.session_results[].results[].starting_position` | int | `-1` | mantido |
| `data.session_results[].results[].starting_position_in_class` | int | `-1` | mantido |
| `data.session_results[].results[].suit.pattern` | int | `0` | removido |
| `data.session_results[].results[].suit.color1` | str | `"000000"` | removido |
| `data.session_results[].results[].suit.color2` | str | `"000000"` | removido |
| `data.session_results[].results[].suit.color3` | str | `"000000"` | removido |
| `data.session_results[].results[].watched` | bool | `false` | removido |
| `data.session_results[].results[].weight_penalty_kg` | int | `-1` | mantido |
| `data.session_splits[].subsession_id` | int | `89199619` | mantido |
| `data.session_splits[].event_strength_of_field` | int | `3092` | mantido |
| `data.special_event_type` | int | `-1` | mantido |
| `data.start_time` | str | `"2026-10-07T21:15:00Z"` | mantido |
| `data.track.category` | str | `"Road"` | mantido |
| `data.track.category_id` | int | `2` | mantido |
| `data.track.config_name` | str | `"Grand Prix"` | mantido |
| `data.track.track_id` | int | `195` | mantido |
| `data.track.track_name` | str | `"Mobility Resort Motegi"` | mantido |
| `data.track_state.leave_marbles` | bool | `true` | mantido |
| `data.track_state.practice_rubber` | int | `-1` | mantido |
| `data.track_state.qualify_rubber` | int | `-1` | mantido |
| `data.track_state.race_rubber` | int | `-1` | mantido |
| `data.track_state.warmup_rubber` | int | `-1` | mantido |
| `data.weather.allow_fog` | bool | `false` | mantido |
| `data.weather.fog` | int | `0` | mantido |
| `data.weather.precip_mm2hr_before_final_session` | int | `0` | mantido |
| `data.weather.precip_mm_final_session` | int | `0` | mantido |
| `data.weather.precip_option` | int | `8` | mantido |
| `data.weather.precip_time_pct` | int | `0` | mantido |
| `data.weather.rel_humidity` | int | `0` | mantido |
| `data.weather.simulated_start_time` | str | `"2026-10-10T11:30:00"` | mantido |
| `data.weather.skies` | int | `2` | mantido |
| `data.weather.temp_units` | int | `1` | mantido |
| `data.weather.temp_value` | int | `26` | mantido |
| `data.weather.time_of_day` | int | `1` | mantido |
| `data.weather.track_water` | int | `0` | mantido |
| `data.weather.type` | int | `3` | mantido |
| `data.weather.version` | int | `1` | mantido |
| `data.weather.weather_var_initial` | int | `0` | mantido |
| `data.weather.weather_var_ongoing` | int | `0` | mantido |
| `data.weather.wind_dir` | int | `7` | mantido |
| `data.weather.wind_units` | int | `1` | mantido |
| `data.weather.wind_value` | int | `0` | mantido |
