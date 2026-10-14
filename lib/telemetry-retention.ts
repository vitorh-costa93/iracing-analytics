import { SEASON_CALENDAR } from './season-calendar';
type RetentionLap = { data_source?: string; created_at?: string; garage61_payload?: { season?: { name?: string }; startTime?: string; sessionType?: number; session_type?: number; session?: string } };
export function keepTelemetry(lap: RetentionLap, current: string, previous: string) {
 const p=lap.garage61_payload;
 let season=p?.season?.name;
 if(!season && lap.data_source==='iracing_agent') {
  const at=Date.parse(p?.startTime??lap.created_at??'');
  season=SEASON_CALENDAR.find(s=>at>=Date.parse(s.start)&&at<Date.parse(s.start)+84*86400000)?.name;
 }
 // Unknown metadata is not evidence that a file expired. Admission/storage caps still apply.
 if(!season)return true;
 const race=p?.session==='Race'||(p?.sessionType??p?.session_type)===3;
 return season===current||(season===previous&&race);
}
