# O que vem no `.ibt` de telemetria (iRacing)

Arquivo inspecionado: `chevyvettez06rgt3_indianapolis 2022 road 2026-10-13 08-24-44.ibt` (29.4 MB), gerado em 13/10/2026 (Corvette Z06 GT3.R, Indianapolis Road). Só leitura do cabeçalho, das variáveis e do SessionInfo; nenhuma amostra de telemetria foi copiada.

## Cabeçalho

| Campo | Valor |
|---|---|
| versão | 2 |
| tickRate | 60 Hz |
| numVars (canais) | 286 |
| bufLen (bytes por amostra) | 1100 |
| lapCount | 6 |
| recordCount (amostras) | 26644 |
| sessionInfoUpdate | 0 |
| tamanho do SessionInfo (YAML) | 14774 bytes |

O `SessionInfo` (YAML) é um snapshot de quando o arquivo foi aberto (`sessionInfoUpdate = 0`): não traz o resultado final da corrida. Blocos de topo: `WeekendInfo`, `SessionInfo`, `CameraInfo`, `RadioInfo`, `DriverInfo`, `SplitTimeInfo`, `CarSetup`.

## SessionInfo — blocos

### WeekendInfo (início; dados de sessão/pista, sem nomes de pilotos)

```yaml
 Encoding: ISO_8859_1
 TrackName: indianapolis 2022 road
 TrackID: 448
 TrackLength: 3.8452 km
 TrackLengthOfficial: 3.93 km
 TrackDisplayName: Indianapolis Motor Speedway
 TrackDisplayShortName: Indianapolis
 TrackConfigName: Road Course
 TrackCity: Indianapolis
 TrackState: IN
 TrackCountry: USA
 TrackAltitude: 220.52 m
 TrackLatitude: 39.793180 m
 TrackLongitude: -86.238867 m
 TrackNorthOffset: 3.1263 rad
 TrackNumTurns: 14
 TrackPitSpeedLimit: 64.37 kph
 TrackPaceSpeed: 72.42 kph
 TrackNumPitStalls: 40
 TrackType: road course
 TrackDirection: neutral
 TrackWeatherType: Realistic
 TrackSkies: Dynamic
 TrackSurfaceTemp: 24.66 C
 TrackSurfaceTempCrew: 19.44 C
 TrackAirTemp: 18.66 C
 TrackAirPressure: 29.12 Hg
 TrackAirDensity: 1.17 kg/m^3
 TrackWindVel: 4.76 m/s
 TrackWindDir: 2.74 rad
 TrackRelativeHumidity: 95 %
 TrackFogLevel: 0 %
 TrackPrecipitation: 0 %
 TrackCleanup: 0
 TrackDynamicTrack: 1
 TrackVersion: 2026.09.23.03
 SeriesID: 444
 SeasonID: 6478
 SessionID: 324547669
 SubSessionID: 89338142
 LeagueID: 0
 LeagueSeasonID: 0
 Official: 1
 RaceWeek: 4
 EventType: Practice
 Category: SportsCar
 SimMode: full
 TeamRacing: 0
 MinDrivers: 0
 MaxDrivers: 1
 DCRuleSet: None
 QualifierMustStartRace: 0
 NumCarClasses: 1
 NumCarTypes: 11
 HeatRacing: 0
 AltAssetTag: 
 BuildType: Release
 BuildTarget: Members
 BuildVersion: 2026.10.01.01
 RaceFarm: US-East-OH
 WeekendOptions:
  NumStarters: 20
  StartingGrid: 2x2 inline pole on left
  QualifyScoring: best lap
  CourseCautions: off
  StandingStart: 1
  ShortParadeLap: 0
  Restarts: single file
  WeatherType: Realistic
  Skies: Dynamic
```

### SessionInfo (sessões do evento)

```yaml
 CurrentSessionNum: 0
 Sessions:
 - SessionNum: 0
   SessionLaps: unlimited
   SessionTime: 7200.0000 sec
   SessionNumLapsToAvg: 0
   SessionType: Practice
   SessionTrackRubberState: moderate usage
   SessionName: PRACTICE
   SessionSubType: 
   SessionSkipped: 0
   SessionRunGroupsUsed: 1
   SessionEnforceTireCompoundChange: 0
   ResultsPositions:
   - Position: 1
     ClassPosition: 0
     CarIdx: 0
     Lap: 4
     Time: 85.5235
     FastestLap: 4
     FastestTime: 85.5235
     LastTime: 85.5235
     LapsLed: 0
     LapsComplete: 4
     JokerLapsComplete: 0
     LapsDriven: 0.000
     Incidents: 0
     ReasonOutId: 0
     ReasonOutStr: Running
   ResultsFastestLap:
   - CarIdx: 0
     FastestLap: 4
     FastestTime: 85.5235
   ResultsAverageLapTime: -1.0000
   ResultsNumCautionFlags: 0
   ResultsNumCautionLaps: 0
   ResultsNumLeadChanges: 0
   ResultsLapsComplete: -1
   ResultsOfficial: 0

```

### DriverInfo (início; dados pessoais mascarados)

```yaml
 DriverCarIdx: 1
 DriverUserID: <mascarado>
 PaceCarIdx: -1
 DriverIsAdmin: 0
 DriverHeadPosX: -0.105
 DriverHeadPosY: 0.325
 DriverHeadPosZ: 0.535
 DriverCarIsElectric: 0
 DriverCarIdleRPM: 1950.000
 DriverCarRedLine: 8000.000
 DriverCarEngCylinderCount: 8
 DriverCarFuelKgPerLtr: 0.750
 DriverCarFuelMaxLtr: 104.000
 DriverCarMaxFuelPct: 0.500
 DriverCarGearNumForward: 6
 DriverCarGearNeutral: 1
 DriverCarGearReverse: 1
 DriverGearboxType: Sequential
 DriverGearboxControlType: Sequential
 DriverCarShiftAid: Antistall_Clutch_Throttle
 DriverCarSLFirstRPM: 7000.000
 DriverCarSLShiftRPM: 7700.000
 DriverCarSLLastRPM: 7600.000
 DriverCarSLBlinkRPM: 7950.000
 DriverCarVersion: 2026.09.25.02
 DriverPitTrkPct: 0.096986
 DriverCarEstLapTime: 81.6184
 DriverSetupName: fixed.sto
 DriverSetupIsModified: 0
 DriverSetupLoadTypeName: fixed
 DriverSetupPassedTech: 1
 DriverIncidentCount: 0
 DriverBrakeCurvingFactor: 0.001
 DriverTires:
 - TireIndex: 0
   TireCompoundType: "Hard"
 - TireIndex: 1
   TireCompoundType: "Wet"
 Drivers:
 - CarIdx: 0
   UserName: <mascarado>
   AbbrevName: <mascarado>
   Initials: <mascarado>
   UserID: <mascarado>
   TeamID: <mascarado>
   TeamName: <mascarado>
   CarNumber: "1"
   CarNumberRaw: 1
   CarPath: porsche992rgt3
   CarClassID: 2708
   CarID: 169
   CarIsPaceCar: 0
   CarIsAI: 0
   CarIsElectric: 0
   CarScreenName: Porsche 911 GT3 R (992)
   CarScreenNameShort: Porsche 911 GT3 R (992)
   CarCfg: -1
   CarCfgName: 
   CarCfgCustomPaintExt: 
   CarClassShortName: GT3 Class
```

### SplitTimeInfo

```yaml
 Sectors:
 - SectorNum: 0
   SectorStartPct: 0.000000
 - SectorNum: 1
   SectorStartPct: 0.260837
 - SectorNum: 2
   SectorStartPct: 0.505260
 - SectorNum: 3
   SectorStartPct: 0.662425

```

### CarSetup (só as chaves; valores omitidos — o setup é privado)

```yaml
 UpdateCount:
 TiresAero:
  TireType:
   TireType:
  LeftFront:
   StartingPressure:
   LastHotPressure:
   LastTempsOMI:
   TreadRemaining:
  LeftRear:
   StartingPressure:
   LastHotPressure:
   LastTempsOMI:
   TreadRemaining:
  RightFront:
   StartingPressure:
   LastHotPressure:
   LastTempsIMO:
   TreadRemaining:
  RightRear:
   StartingPressure:
   LastHotPressure:
   LastTempsIMO:
   TreadRemaining:
  AeroBalanceCalc:
   FrontRhAtSpeed:
   RearRhAtSpeed:
   RearWingAngle:
   FrontDownforce:
 Chassis:
  FrontBrakes:
   ArbBlades:
   TotalToeIn:
   BrakePedalRatio:
   BrakePads:
   FWtdist:
   CenterFrontSplitterHeight:
  LeftFront:
   CornerWeight:
   RideHeight:
   BumpRubberGap:
   SpringRate:
   Camber:
  LeftRear:
   CornerWeight:
   RideHeight:
   BumpRubberGap:
   SpringRate:
   Camber:
   ToeIn:
  Rear:
   FuelLevel:
   ArbBlades:
   RearWingAngle:
  InCarAdjustments:
   BrakePressureBias:
   AbsSetting:
   TcSetting:
   DashDisplayPage:
   CrossWeight:
  RightFront:
   CornerWeight:
   RideHeight:
   BumpRubberGap:
   SpringRate:
   Camber:
  RightRear:
   CornerWeight:
   RideHeight:
   BumpRubberGap:
```

## Canais de telemetria (286)

Coluna *Agente* indica os canais que o agente lê hoje (`agent/Ibt.cs`); os demais ficam disponíveis no arquivo mas não são enviados.

| Canal | Tipo | Itens | Unidade | Descrição | Agente |
|---|---|---|---|---|---|
| `SessionTime` | double | 1 | s | Seconds since session start | sim |
| `SessionTick` | int | 1 |  | Current update number |  |
| `SessionNum` | int | 1 |  | Session number |  |
| `SessionState` | int | 1 | irsdk_SessionState | Session state |  |
| `SessionUniqueID` | int | 1 |  | Session ID |  |
| `SessionFlags` | bitfield | 1 | irsdk_Flags | Session flags |  |
| `SessionTimeRemain` | double | 1 | s | Seconds left till session ends |  |
| `SessionLapsRemain` | int | 1 |  | Old laps left till session ends use SessionLapsRemainEx |  |
| `SessionLapsRemainEx` | int | 1 |  | New improved laps left till session ends |  |
| `SessionTimeTotal` | double | 1 | s | Total number of seconds in session |  |
| `SessionLapsTotal` | int | 1 |  | Total number of laps in session |  |
| `SessionJokerLapsRemain` | int | 1 |  | Joker laps remaining to be taken |  |
| `SessionOnJokerLap` | bool | 1 |  | Player is currently completing a joker lap |  |
| `SessionTimeOfDay` | float | 1 | s | Time of day in seconds |  |
| `DriverMarker` | bool | 1 |  | Driver activated flag |  |
| `PushToTalk` | bool | 1 |  | Push to talk button state |  |
| `PushToPass` | bool | 1 |  | Push to pass button state | sim |
| `ManualBoost` | bool | 1 |  | Hybrid manual boost state |  |
| `ManualNoBoost` | bool | 1 |  | Hybrid manual no boost state |  |
| `IsOnTrack` | bool | 1 |  | 1=Car on track physics running with player in car |  |
| `FrameRate` | float | 1 | fps | Average frames per second |  |
| `CpuUsageFG` | float | 1 | % | Percent of available time fg thread took with a 1 sec avg |  |
| `GpuUsage` | float | 1 | % | Percent of available time gpu took with a 1 sec avg |  |
| `ChanAvgLatency` | float | 1 | s | Communications average latency |  |
| `ChanLatency` | float | 1 | s | Communications latency |  |
| `ChanQuality` | float | 1 | % | Communications quality |  |
| `ChanPartnerQuality` | float | 1 | % | Partner communications quality |  |
| `CpuUsageBG` | float | 1 | % | Percent of available time bg thread took with a 1 sec avg |  |
| `ChanClockSkew` | float | 1 | s | Communications server clock skew |  |
| `MemPageFaultSec` | float | 1 |  | Memory page faults per second |  |
| `MemSoftPageFaultSec` | float | 1 |  | Memory soft page faults per second |  |
| `PlayerCarPosition` | int | 1 |  | Players position in race |  |
| `PlayerCarClassPosition` | int | 1 |  | Players class position in race |  |
| `PlayerCarClass` | int | 1 |  | Player car class id |  |
| `PlayerTrackSurface` | int | 1 | irsdk_TrkLoc | Players car track surface type |  |
| `PlayerTrackSurfaceMaterial` | int | 1 | irsdk_TrkSurf | Players car track surface material type |  |
| `PlayerCarIdx` | int | 1 |  | Players carIdx |  |
| `PlayerCarTeamIncidentCount` | int | 1 |  | Players team incident count for this session |  |
| `PlayerCarMyIncidentCount` | int | 1 |  | Players own incident count for this session | sim |
| `PlayerCarDriverIncidentCount` | int | 1 |  | Teams current drivers incident count for this session |  |
| `PlayerCarWeightPenalty` | float | 1 | kg | Players weight penalty |  |
| `PlayerCarPowerAdjust` | float | 1 | % | Players power adjust |  |
| `PlayerCarDryTireSetLimit` | int | 1 |  | Players dry tire set limit |  |
| `PlayerCarTowTime` | float | 1 | s | Players car is being towed if time is greater than zero |  |
| `PlayerCarInPitStall` | bool | 1 |  | Players car is properly in their pitstall |  |
| `PlayerCarPitSvStatus` | int | 1 | irsdk_PitSvStatus | Players car pit service status bits |  |
| `PlayerTireCompound` | int | 1 |  | Players car current tire compound |  |
| `PlayerFastRepairsUsed` | int | 1 |  | Players car number of fast repairs used |  |
| `OnPitRoad` | bool | 1 |  | Is the player car on pit road between the cones | sim |
| `PaceMode` | int | 1 | irsdk_PaceMode | Are we pacing or not |  |
| `SteeringWheelAngle` | float | 1 | rad | Steering wheel angle | sim |
| `Throttle` | float | 1 | % | 0=off throttle to 1=full throttle | sim |
| `Brake` | float | 1 | % | 0=brake released to 1=max pedal force | sim |
| `Clutch` | float | 1 | % | 0=disengaged to 1=fully engaged | sim |
| `Gear` | int | 1 |  | -1=reverse  0=neutral  1..n=current gear | sim |
| `RPM` | float | 1 | revs/min | Engine rpm | sim |
| `Lap` | int | 1 |  | Laps started count |  |
| `LapCompleted` | int | 1 |  | Laps completed count |  |
| `LapDist` | float | 1 | m | Meters traveled from S/F this lap |  |
| `LapDistPct` | float | 1 | % | Percentage distance around lap | sim |
| `CarDistAhead` | float | 1 | m | Distance to first car in front of player in meters |  |
| `CarDistBehind` | float | 1 | m | Distance to first car behind player in meters |  |
| `LapBestLap` | int | 1 |  | Players best lap number |  |
| `LapBestLapTime` | float | 1 | s | Players best lap time |  |
| `LapLastLapTime` | float | 1 | s | Players last lap time |  |
| `LapCurrentLapTime` | float | 1 | s | Estimate of players current lap time as shown in F3 box | sim |
| `LapLasNLapSeq` | int | 1 |  | Player num consecutive clean laps completed for N average |  |
| `LapLastNLapTime` | float | 1 | s | Player last N average lap time |  |
| `LapBestNLapLap` | int | 1 |  | Player last lap in best N average lap time |  |
| `LapBestNLapTime` | float | 1 | s | Player best N average lap time |  |
| `LapDeltaToBestLap` | float | 1 | s | Delta time for best lap |  |
| `LapDeltaToBestLap_DD` | float | 1 | s/s | Rate of change of delta time for best lap |  |
| `LapDeltaToBestLap_OK` | bool | 1 |  | Delta time for best lap is valid |  |
| `LapDeltaToOptimalLap` | float | 1 | s | Delta time for optimal lap |  |
| `LapDeltaToOptimalLap_DD` | float | 1 | s/s | Rate of change of delta time for optimal lap |  |
| `LapDeltaToOptimalLap_OK` | bool | 1 |  | Delta time for optimal lap is valid |  |
| `LapDeltaToSessionBestLap` | float | 1 | s | Delta time for session best lap |  |
| `LapDeltaToSessionBestLap_DD` | float | 1 | s/s | Rate of change of delta time for session best lap |  |
| `LapDeltaToSessionBestLap_OK` | bool | 1 |  | Delta time for session best lap is valid |  |
| `LapDeltaToSessionOptimalLap` | float | 1 | s | Delta time for session optimal lap |  |
| `LapDeltaToSessionOptimalLap_DD` | float | 1 | s/s | Rate of change of delta time for session optimal lap |  |
| `LapDeltaToSessionOptimalLap_OK` | bool | 1 |  | Delta time for session optimal lap is valid |  |
| `LapDeltaToSessionLastlLap` | float | 1 | s | Delta time for session last lap |  |
| `LapDeltaToSessionLastlLap_DD` | float | 1 | s/s | Rate of change of delta time for session last lap |  |
| `LapDeltaToSessionLastlLap_OK` | bool | 1 |  | Delta time for session last lap is valid |  |
| `Speed` | float | 1 | m/s | GPS vehicle speed | sim |
| `Yaw` | float | 1 | rad | Yaw orientation |  |
| `YawNorth` | float | 1 | rad | Yaw orientation relative to north |  |
| `Pitch` | float | 1 | rad | Pitch orientation |  |
| `Roll` | float | 1 | rad | Roll orientation |  |
| `EnterExitReset` | int | 1 |  | Indicate action the reset key will take 0 enter 1 exit 2 reset |  |
| `Lat` | double | 1 | deg | Latitude in decimal degrees | sim |
| `Lon` | double | 1 | deg | Longitude in decimal degrees | sim |
| `Alt` | float | 1 | m | Altitude in meters |  |
| `TrackTemp` | float | 1 | C | Deprecated  set to TrackTempCrew |  |
| `TrackTempCrew` | float | 1 | C | Temperature of track measured by crew around track |  |
| `AirTemp` | float | 1 | C | Temperature of air at start/finish line |  |
| `TrackWetness` | int | 1 | irsdk_TrackWetness | How wet is the average track surface |  |
| `Skies` | int | 1 |  | Skies (0=clear/1=p cloudy/2=m cloudy/3=overcast) |  |
| `AirDensity` | float | 1 | kg/m^3 | Density of air at start/finish line |  |
| `AirPressure` | float | 1 | Pa | Pressure of air at start/finish line |  |
| `WindVel` | float | 1 | m/s | Wind velocity at start/finish line |  |
| `WindDir` | float | 1 | rad | Wind direction at start/finish line |  |
| `RelativeHumidity` | float | 1 | % | Relative Humidity at start/finish line |  |
| `FogLevel` | float | 1 | % | Fog level at start/finish line |  |
| `Precipitation` | float | 1 | % | Precipitation at start/finish line |  |
| `SolarAltitude` | float | 1 | rad | Sun angle above horizon in radians |  |
| `SolarAzimuth` | float | 1 | rad | Sun angle clockwise from north in radians |  |
| `WeatherDeclaredWet` | bool | 1 |  | The steward says rain tires can be used |  |
| `PitsOpen` | bool | 1 |  | True if pit stop is allowed for the current player |  |
| `PlayerIncidents` | int | 1 | irsdk_IncidentFlags | Log incidents that the player recieved |  |
| `PitRepairLeft` | float | 1 | s | Time left for mandatory pit repairs if repairs are active |  |
| `PitOptRepairLeft` | float | 1 | s | Time left for optional repairs if repairs are active |  |
| `PitstopActive` | bool | 1 |  | Is the player getting pit stop service |  |
| `FastRepairUsed` | int | 1 |  | How many fast repairs used so far |  |
| `FastRepairAvailable` | int | 1 |  | How many fast repairs left  255 is unlimited |  |
| `LFTiresUsed` | int | 1 |  | How many left front tires used so far |  |
| `RFTiresUsed` | int | 1 |  | How many right front tires used so far |  |
| `LRTiresUsed` | int | 1 |  | How many left rear tires used so far |  |
| `RRTiresUsed` | int | 1 |  | How many right rear tires used so far |  |
| `LeftTireSetsUsed` | int | 1 |  | How many left tire sets used so far |  |
| `RightTireSetsUsed` | int | 1 |  | How many right tire sets used so far |  |
| `FrontTireSetsUsed` | int | 1 |  | How many front tire sets used so far |  |
| `RearTireSetsUsed` | int | 1 |  | How many rear tire sets used so far |  |
| `TireSetsUsed` | int | 1 |  | How many tire sets used so far |  |
| `LFTiresAvailable` | int | 1 |  | How many left front tires are remaining  255 is unlimited |  |
| `RFTiresAvailable` | int | 1 |  | How many right front tires are remaining  255 is unlimited |  |
| `LRTiresAvailable` | int | 1 |  | How many left rear tires are remaining  255 is unlimited |  |
| `RRTiresAvailable` | int | 1 |  | How many right rear tires are remaining  255 is unlimited |  |
| `LeftTireSetsAvailable` | int | 1 |  | How many left tire sets are remaining  255 is unlimited |  |
| `RightTireSetsAvailable` | int | 1 |  | How many right tire sets are remaining  255 is unlimited |  |
| `FrontTireSetsAvailable` | int | 1 |  | How many front tire sets are remaining  255 is unlimited |  |
| `RearTireSetsAvailable` | int | 1 |  | How many rear tire sets are remaining  255 is unlimited |  |
| `TireSetsAvailable` | int | 1 |  | How many tire sets are remaining  255 is unlimited |  |
| `IsOnTrackCar` | bool | 1 |  | 1=Car on track physics running |  |
| `SteeringWheelAngleMax` | float | 1 | rad | Steering wheel max angle |  |
| `ShiftPowerPct` | float | 1 | % | Friction torque applied to gears when shifting or grinding |  |
| `ShiftGrindRPM` | float | 1 | RPM | RPM of shifter grinding noise |  |
| `ThrottleRaw` | float | 1 | % | Raw throttle input 0=off throttle to 1=full throttle |  |
| `BrakeRaw` | float | 1 | % | Raw brake input 0=brake released to 1=max pedal force |  |
| `ClutchRaw` | float | 1 | % | Raw clutch input 0=disengaged to 1=fully engaged |  |
| `HandbrakeRaw` | float | 1 | % | Raw handbrake input 0=handbrake released to 1=max force |  |
| `BrakeABSactive` | bool | 1 |  | true if abs is currently reducing brake force pressure | sim |
| `BrakeABScutPct` | float | 1 | % | Percent of brake force reduction caused by ABS system |  |
| `Shifter` | int | 1 |  | Log inputs from the players shifter control |  |
| `EngineWarnings` | bitfield | 1 | irsdk_EngineWarnings | Bitfield for warning lights |  |
| `FuelLevelPct` | float | 1 | % | Percent fuel remaining |  |
| `PitSvFlags` | bitfield | 1 | irsdk_PitSvFlags | Bitfield of pit service checkboxes |  |
| `PitSvLFP` | float | 1 | kPa | Pit service left front tire pressure |  |
| `PitSvRFP` | float | 1 | kPa | Pit service right front tire pressure |  |
| `PitSvLRP` | float | 1 | kPa | Pit service left rear tire pressure |  |
| `PitSvRRP` | float | 1 | kPa | Pit service right rear tire pressure |  |
| `PitSvFuel` | float | 1 | l or kWh | Pit service fuel add amount |  |
| `PitSvTireCompound` | int | 1 |  | Pit service pending tire compound |  |
| `P2P_Status` | bool | 1 |  | Push2Pass active or not on your car |  |
| `P2P_Count` | int | 1 |  | Push2Pass count of usage (or remaining in Race) on your car |  |
| `SteeringWheelPctTorque` | float | 1 | % | Force feedback % max torque on steering shaft unsigned |  |
| `SteeringWheelPctTorqueSign` | float | 1 | % | Force feedback % max torque on steering shaft signed |  |
| `SteeringWheelPctTorqueSignStops` | float | 1 | % | Force feedback % max torque on steering shaft signed stops |  |
| `SteeringWheelPctIntensity` | float | 1 | % | Force feedback % max intensity |  |
| `SteeringWheelPctSmoothing` | float | 1 | % | Force feedback % max smoothing |  |
| `SteeringWheelPctDamper` | float | 1 | % | Force feedback % max damping |  |
| `SteeringWheelLimiter` | float | 1 | % | Force feedback limiter strength limits impacts and oscillation |  |
| `SteeringWheelMaxForceNm` | float | 1 | N*m | Value of strength or max force slider in Nm for FFB |  |
| `SteeringWheelUseLinear` | bool | 1 |  | True if steering wheel force is using linear mode |  |
| `ShiftIndicatorPct` | float | 1 | % | DEPRECATED use DriverCarSLBlinkRPM instead |  |
| `TireLF_RumblePitch` | float | 1 | Hz | Players LF Tire Sound rumblestrip pitch |  |
| `TireRF_RumblePitch` | float | 1 | Hz | Players RF Tire Sound rumblestrip pitch |  |
| `TireLR_RumblePitch` | float | 1 | Hz | Players LR Tire Sound rumblestrip pitch |  |
| `TireRR_RumblePitch` | float | 1 | Hz | Players RR Tire Sound rumblestrip pitch |  |
| `SteeringWheelTorque_ST` | float | 6 | N*m | Output torque on steering shaft at 360 Hz |  |
| `SteeringWheelTorque` | float | 1 | N*m | Output torque on steering shaft |  |
| `VelocityZ` | float | 1 | m/s | Z velocity |  |
| `VelocityY` | float | 1 | m/s | Y velocity |  |
| `VelocityX` | float | 1 | m/s | X velocity |  |
| `YawRate` | float | 1 | rad/s | Yaw rate | sim |
| `PitchRate` | float | 1 | rad/s | Pitch rate |  |
| `RollRate` | float | 1 | rad/s | Roll rate |  |
| `VertAccel` | float | 1 | m/s^2 | Vertical acceleration (including gravity) |  |
| `LatAccel` | float | 1 | m/s^2 | Lateral acceleration (including gravity) | sim |
| `LongAccel` | float | 1 | m/s^2 | Longitudinal acceleration (including gravity) | sim |
| `dcStarter` | bool | 1 |  | In car trigger car starter |  |
| `dcPitSpeedLimiterToggle` | bool | 1 |  | Track if pit speed limiter system is enabled |  |
| `dcTractionControlToggle` | bool | 1 |  | In car traction control active |  |
| `dcHeadlightFlash` | bool | 1 |  | In car headlight flash control active |  |
| `dcLowFuelAccept` | bool | 1 |  | In car low fuel accept |  |
| `dpRFTireChange` | float | 1 |  | Pitstop rf tire change request |  |
| `dpLFTireChange` | float | 1 |  | Pitstop lf tire change request |  |
| `dpRRTireChange` | float | 1 |  | Pitstop rr tire change request |  |
| `dpLRTireChange` | float | 1 |  | Pitstop lr tire change request |  |
| `dpFuelFill` | float | 1 |  | Pitstop fuel fill flag |  |
| `dpFuelAutoFillEnabled` | float | 1 |  | Pitstop auto fill fuel system enabled |  |
| `dpFuelAutoFillActive` | float | 1 |  | Pitstop auto fill fuel next stop flag |  |
| `dpWindshieldTearoff` | float | 1 |  | Pitstop windshield tearoff |  |
| `dpFuelAddKg` | float | 1 | kg | Pitstop fuel add amount |  |
| `dpFastRepair` | float | 1 |  | Pitstop fast repair set |  |
| `dcDashPage` | float | 1 |  | In car dash display page adjustment |  |
| `dcBrakeBias` | float | 1 |  | In car brake bias adjustment |  |
| `dpLFTireColdPress` | float | 1 | Pa | Pitstop lf tire cold pressure adjustment |  |
| `dpRFTireColdPress` | float | 1 | Pa | Pitstop rf cold tire pressure adjustment |  |
| `dpLRTireColdPress` | float | 1 | Pa | Pitstop lr tire cold pressure adjustment |  |
| `dpRRTireColdPress` | float | 1 | Pa | Pitstop rr cold tire pressure adjustment |  |
| `dcTractionControl` | float | 1 |  | In car traction control adjustment |  |
| `dcABS` | float | 1 |  | In car abs adjustment |  |
| `dcToggleWindshieldWipers` | bool | 1 |  | In car turn wipers on or off |  |
| `dcTriggerWindshieldWipers` | bool | 1 |  | In car momentarily turn on wipers |  |
| `RFbrakeLinePress` | float | 1 | bar | RF brake line pressure |  |
| `RFspeed` | float | 1 | m/s | RF wheel speed |  |
| `RFpressure` | float | 1 | kPa | RF tire pressure |  |
| `RFcoldPressure` | float | 1 | kPa | RF tire cold pressure  as set in the garage |  |
| `RFodometer` | float | 1 | m | RF distance tire traveled since being placed on car |  |
| `RFtempL` | float | 1 | C | RF tire left surface temperature |  |
| `RFtempM` | float | 1 | C | RF tire middle surface temperature |  |
| `RFtempR` | float | 1 | C | RF tire right surface temperature |  |
| `RFtempCL` | float | 1 | C | RF tire left carcass temperature |  |
| `RFtempCM` | float | 1 | C | RF tire middle carcass temperature |  |
| `RFtempCR` | float | 1 | C | RF tire right carcass temperature |  |
| `RFwearL` | float | 1 | % | RF tire left percent tread remaining |  |
| `RFwearM` | float | 1 | % | RF tire middle percent tread remaining |  |
| `RFwearR` | float | 1 | % | RF tire right percent tread remaining |  |
| `LFbrakeLinePress` | float | 1 | bar | LF brake line pressure |  |
| `LFspeed` | float | 1 | m/s | LF wheel speed |  |
| `LFpressure` | float | 1 | kPa | LF tire pressure |  |
| `LFcoldPressure` | float | 1 | kPa | LF tire cold pressure  as set in the garage |  |
| `LFodometer` | float | 1 | m | LF distance tire traveled since being placed on car |  |
| `LFtempL` | float | 1 | C | LF tire left surface temperature |  |
| `LFtempM` | float | 1 | C | LF tire middle surface temperature |  |
| `LFtempR` | float | 1 | C | LF tire right surface temperature |  |
| `LFtempCL` | float | 1 | C | LF tire left carcass temperature |  |
| `LFtempCM` | float | 1 | C | LF tire middle carcass temperature |  |
| `LFtempCR` | float | 1 | C | LF tire right carcass temperature |  |
| `LFwearL` | float | 1 | % | LF tire left percent tread remaining |  |
| `LFwearM` | float | 1 | % | LF tire middle percent tread remaining |  |
| `LFwearR` | float | 1 | % | LF tire right percent tread remaining |  |
| `RRbrakeLinePress` | float | 1 | bar | RR brake line pressure |  |
| `RRspeed` | float | 1 | m/s | RR wheel speed |  |
| `RRpressure` | float | 1 | kPa | RR tire pressure |  |
| `RRcoldPressure` | float | 1 | kPa | RR tire cold pressure  as set in the garage |  |
| `RRodometer` | float | 1 | m | RR distance tire traveled since being placed on car |  |
| `RRtempL` | float | 1 | C | RR tire left surface temperature |  |
| `RRtempM` | float | 1 | C | RR tire middle surface temperature |  |
| `RRtempR` | float | 1 | C | RR tire right surface temperature |  |
| `RRtempCL` | float | 1 | C | RR tire left carcass temperature |  |
| `RRtempCM` | float | 1 | C | RR tire middle carcass temperature |  |
| `RRtempCR` | float | 1 | C | RR tire right carcass temperature |  |
| `RRwearL` | float | 1 | % | RR tire left percent tread remaining |  |
| `RRwearM` | float | 1 | % | RR tire middle percent tread remaining |  |
| `RRwearR` | float | 1 | % | RR tire right percent tread remaining |  |
| `LRbrakeLinePress` | float | 1 | bar | LR brake line pressure |  |
| `LRspeed` | float | 1 | m/s | LR wheel speed |  |
| `LRpressure` | float | 1 | kPa | LR tire pressure |  |
| `LRcoldPressure` | float | 1 | kPa | LR tire cold pressure  as set in the garage |  |
| `LRodometer` | float | 1 | m | LR distance tire traveled since being placed on car |  |
| `LRtempL` | float | 1 | C | LR tire left surface temperature |  |
| `LRtempM` | float | 1 | C | LR tire middle surface temperature |  |
| `LRtempR` | float | 1 | C | LR tire right surface temperature |  |
| `LRtempCL` | float | 1 | C | LR tire left carcass temperature |  |
| `LRtempCM` | float | 1 | C | LR tire middle carcass temperature |  |
| `LRtempCR` | float | 1 | C | LR tire right carcass temperature |  |
| `LRwearL` | float | 1 | % | LR tire left percent tread remaining |  |
| `LRwearM` | float | 1 | % | LR tire middle percent tread remaining |  |
| `LRwearR` | float | 1 | % | LR tire right percent tread remaining |  |
| `FuelUsePerHour` | float | 1 | kg/h | Engine fuel used instantaneous |  |
| `Voltage` | float | 1 | V | Engine voltage |  |
| `WaterTemp` | float | 1 | C | Engine coolant temp |  |
| `WaterLevel` | float | 1 | l | Engine coolant level |  |
| `FuelPress` | float | 1 | bar | Engine fuel pressure |  |
| `OilTemp` | float | 1 | C | Engine oil temperature |  |
| `OilPress` | float | 1 | bar | Engine oil pressure |  |
| `OilLevel` | float | 1 | l | Engine oil level |  |
| `ManifoldPress` | float | 1 | bar | Engine manifold pressure |  |
| `FuelLevel` | float | 1 | l | Liters of fuel remaining | sim |
| `Engine0_RPM` | float | 1 | revs/min | Engine0Engine rpm |  |
| `LRshockDefl` | float | 1 | m | LR shock deflection |  |
| `LRshockVel` | float | 1 | m/s | LR shock velocity |  |
| `RRshockDefl` | float | 1 | m | RR shock deflection |  |
| `RRshockVel` | float | 1 | m/s | RR shock velocity |  |
| `LFshockDefl` | float | 1 | m | LF shock deflection |  |
| `LFshockVel` | float | 1 | m/s | LF shock velocity |  |
| `RFshockDefl` | float | 1 | m | RF shock deflection |  |
| `RFshockVel` | float | 1 | m/s | RF shock velocity |  |
| `LFrideHeight` | float | 1 | m | LF ride height |  |
| `RFrideHeight` | float | 1 | m | RF ride height |  |
| `LRrideHeight` | float | 1 | m | LR ride height |  |
| `RRrideHeight` | float | 1 | m | RR ride height |  |
| `CFSRrideHeight` | float | 1 | m | Center front splitter ride height |  |
