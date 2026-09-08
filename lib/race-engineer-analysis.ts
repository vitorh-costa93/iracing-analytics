export type Category = "formula_car" | "sports_car";

export type RaceInput = {
  raced_at: string;
  category: Category;
  series_name: string;
  track_name: string;
  car_name: string;
  season_week: number | null;
  finish_position: number;
  grid_position: number | null;
  position_change: number | null;
  irating_after: number;
  irating_before: number;
  sof: number | null;
  incidents: number | null;
  laps?: number | null;
  fastest_lap_time?: string | null;
};

type Group = { label: string; races: number; delta: number; avgDelta: number; avgIncidents: number | null; avgPositionChange: number | null; avgSof: number | null };

const sum=(values:number[])=>values.reduce((total,value)=>total+value,0);
const avg=(values:Array<number|null|undefined>)=>{const usable=values.filter((value):value is number=>typeof value==="number"&&Number.isFinite(value));return usable.length?sum(usable)/usable.length:null};
const round=(value:number|null,decimals=1)=>value===null?null:Number(value.toFixed(decimals));
const signed=(value:number)=>String(value>0?"+":"")+value.toFixed(1);
const delta=(race:RaceInput)=>race.irating_after-race.irating_before;

function compare(rows:RaceInput[],name:string,predicate:(row:RaceInput)=>boolean):Group{
 const items=rows.filter(predicate),deltas=items.map(delta);
 return{label:name,races:items.length,delta:sum(deltas),avgDelta:items.length?sum(deltas)/items.length:0,avgIncidents:round(avg(items.map(row=>row.incidents))),avgPositionChange:round(avg(items.map(row=>row.position_change))),avgSof:round(avg(items.map(row=>row.sof)),0)};
}

function groupContexts(rows:RaceInput[]){
 const groups=new Map<string,RaceInput[]>();
 for(const row of rows){const context=row.car_name+" • "+row.track_name;groups.set(context,[...(groups.get(context)??[]),row])}
 return[...groups.entries()].map(([context,items])=>({context,races:items.length,delta:sum(items.map(delta)),avgDelta:sum(items.map(delta))/items.length,wins:items.filter(row=>row.finish_position===1).length,avgIncidents:round(avg(items.map(row=>row.incidents))),avgPositionChange:round(avg(items.map(row=>row.position_change)))})).sort((a,b)=>a.delta-b.delta);
}

function lossRuns(rows:RaceInput[]){
 const runs:{races:RaceInput[];delta:number}[]=[];let active:RaceInput[]=[];
 const flush=()=>{if(active.length)runs.push({races:active,delta:sum(active.map(delta))});active=[]};
 for(const row of rows){if(delta(row)<0)active.push(row);else flush()}flush();
 return runs.sort((a,b)=>a.delta-b.delta);
}

function bestStreak(rows:RaceInput[],kind:"gain"|"loss"){
 const runs:Array<{length:number;delta:number;start:string;end:string}>=[];let active:RaceInput[]=[];const matches=(row:RaceInput)=>kind==="gain"?delta(row)>0:delta(row)<0;const flush=()=>{if(active.length)runs.push({length:active.length,delta:sum(active.map(delta)),start:active[0].raced_at,end:active[active.length-1].raced_at});active=[]};for(const row of rows){if(matches(row))active.push(row);else flush()}flush();return runs.sort((a,b)=>b.length-a.length||Math.abs(b.delta)-Math.abs(a.delta))[0]??{length:0,delta:0,start:"",end:""};
}

function confidence(rows:RaceInput[],previous:RaceInput[]){if(rows.length>=12&&previous.length>=8)return"alta";if(rows.length>=6)return"média";return"baixa"}

// 08/09/2026: "se comportar como se fosse meu engenheiro... um relatório bem descritivo" -- o pedido
// original citava um exemplo específico (mais vitórias na season, mas iRating caiu) e pedia pra IA
// amarrar esse tipo de contradição em texto corrido ANTES das tabelas. As tabelas/findings abaixo já
// existiam e são mais precisas, mas exigem que o piloto some os números sozinho; este resumo abre a
// seção com 2-3 frases que já fazem essa leitura, apontando o principal responsável (perdas severas
// concentradas ou uma sequência negativa) sem inventar causa além do que os dados já comprovam.
function executiveSummary(opts:{scope:"week"|"season";races:number;baselineRaces:number;net:number;previousNet:number;wins:number;previousWins:number;severeCount:number;severeShare:number;worstRun:{length:number;delta:number}|undefined}):string{
 const{scope,races,baselineRaces,net,previousNet,wins,previousWins,severeCount,severeShare,worstRun}=opts;
 const periodLabel=scope==="week"?"nesta week":"nesta season",referenceLabel=scope==="week"?"nas outras weeks desta season":"na season anterior";
 if(!baselineRaces)return"Saldo de "+signed(net)+" de iRating em "+String(races)+" corridas "+periodLabel+". Ainda não há amostra de referência equivalente para comparar."+(wins?" Foram "+String(wins)+" vitórias no período.":"");
 const netWorse=net<previousNet,netBetter=net>previousNet;
 // Contagem bruta de vitórias só é comparável quando as duas janelas têm escala parecida (season até
 // agora vs. season anterior inteira -- é o enquadramento que o próprio piloto usa, "tive mais
 // vitórias essa temporada"). Numa week isolada contra o total somado de todas as outras semanas da
 // season, contagem bruta compara 1 corrida com dezenas: usa taxa de vitórias (%) nesse caso.
 const useRate=scope==="week",currentRate=races?wins/races*100:0,previousRate=baselineRaces?previousWins/baselineRaces*100:0,winsUp=useRate?currentRate>previousRate:wins>previousWins,winsDown=useRate?currentRate<previousRate:wins<previousWins;
 const now=useRate?currentRate.toFixed(1)+"% de vitórias":String(wins)+" vitória"+(wins===1?"":"s"),before=useRate?previousRate.toFixed(1)+"%":String(previousWins)+" vitória"+(previousWins===1?"":"s");
 const nowBare=useRate?currentRate.toFixed(1)+"%":now,beforeBare=useRate?previousRate.toFixed(1)+"%":before;
 let opening:string;
 if(winsUp&&netWorse)opening="Você teve "+now+" "+periodLabel+" (contra "+before+" "+referenceLabel+"), mas o saldo de iRating piorou ("+signed(net)+" contra "+signed(previousNet)+"). Isso não é uma contradição: vitórias e saldo de iRating respondem a coisas diferentes.";
 else if(winsDown&&netBetter)opening="Você teve "+now+" "+periodLabel+" (contra "+before+" "+referenceLabel+"), mesmo com o saldo de iRating melhor ("+signed(net)+" contra "+signed(previousNet)+"). O ganho veio de resultados consistentes fora do pódio, não de dominar a prova.";
 else if(winsUp&&!netWorse)opening=(useRate?"Taxa de vitórias":"Vitórias")+" ("+nowBare+" contra "+beforeBare+") e saldo de iRating ("+signed(net)+" contra "+signed(previousNet)+") melhoraram juntos "+periodLabel+" — sinal de que o ritmo geral acompanhou os resultados de destaque.";
 else if(winsDown&&netWorse)opening=(useRate?"Taxa de vitórias":"Vitórias")+" ("+nowBare+" contra "+beforeBare+") e saldo de iRating ("+signed(net)+" contra "+signed(previousNet)+") pioraram juntos "+periodLabel+".";
 else opening="O saldo de iRating ficou em "+signed(net)+" "+periodLabel+" contra "+signed(previousNet)+" "+referenceLabel+", com "+now+" contra "+before+".";
 const severeText=severeCount?String(severeCount)+" corrida"+(severeCount===1?"":"s")+" com perda severa (mais de 50 de iRating) concentr"+(severeCount===1?"ou":"aram")+" "+severeShare.toFixed(1)+"% de todo o prejuízo":null;
 const streakText=worstRun&&worstRun.length>=2?"a pior sequência negativa reuniu "+String(worstRun.length)+" corridas seguidas e custou "+signed(worstRun.delta):null;
 const driver=severeText&&streakText?" O principal responsável foi a concentração de perdas: "+severeText+", e "+streakText+".":severeText?" O principal responsável foi a concentração de perdas: "+severeText+".":streakText?" O principal responsável foi a sequência negativa: "+streakText+".":netWorse?" As perdas ficaram distribuídas, sem um evento isolado que explique o resultado sozinho.":"";
 return opening+driver;
}

export function buildEngineerSection(category:Category,rows:RaceInput[],previous:RaceInput[],scope:"week"|"season",week:number|null,sectionLabel?:string,segment?:string){
 const races=[...rows].sort((a,b)=>new Date(a.raced_at).getTime()-new Date(b.raced_at).getTime()),baseline=[...previous].sort((a,b)=>new Date(a.raced_at).getTime()-new Date(b.raced_at).getTime());
 const net=sum(races.map(delta)),previousNet=sum(baseline.map(delta)),positive=compare(races,"Ganharam iRating",row=>delta(row)>0),negative=compare(races,"Perderam iRating",row=>delta(row)<0),wins=compare(races,"Vitórias",row=>row.finish_position===1),previousWins=compare(baseline,"Vitórias (referência)",row=>row.finish_position===1),podiums=races.filter(row=>row.finish_position<=3).length;
 const contexts=groupContexts(races),totalLoss=Math.abs(sum(races.filter(row=>delta(row)<0).map(delta)));
 const severeThreshold=50;
 const baselineTotalLoss=Math.abs(sum(baseline.filter(row=>delta(row)<0).map(delta))),severe=races.filter(row=>delta(row)<-severeThreshold),previousSevere=baseline.filter(row=>delta(row)<-severeThreshold),severeTotal=Math.abs(sum(severe.map(delta))),previousSevereTotal=Math.abs(sum(previousSevere.map(delta))),severeShare=totalLoss?severeTotal/totalLoss*100:0,previousSevereShare=baselineTotalLoss?previousSevereTotal/baselineTotalLoss*100:0,severeRate=races.length?severe.length/races.length*100:0,previousSevereRate=baseline.length?previousSevere.length/baseline.length*100:0;
 const averageGain=avg(races.filter(row=>delta(row)>0).map(delta))??0,previousAverageGain=avg(baseline.filter(row=>delta(row)>0).map(delta))??0,averageSevereLoss=severe.length?Math.abs(avg(severe.map(delta))??0):null,previousAverageSevereLoss=previousSevere.length?Math.abs(avg(previousSevere.map(delta))??0):null,gainsToRecover=averageGain&&averageSevereLoss!==null?averageSevereLoss/averageGain:null,previousGainsToRecover=previousAverageGain&&previousAverageSevereLoss!==null?previousAverageSevereLoss/previousAverageGain:null;
 const worstRun=lossRuns(races)[0],previousWorstRun=lossRuns(baseline)[0],gainStreak=bestStreak(races,"gain"),lossStreak=bestStreak(races,"loss"),referenceGainStreak=bestStreak(baseline,"gain"),referenceLossStreak=bestStreak(baseline,"loss"),previousAverageLoss=avg(baseline.filter(row=>delta(row)<0).map(delta)),currentAverageLoss=avg(races.filter(row=>delta(row)<0).map(delta)),lossSeverityChange=previousAverageLoss&&currentAverageLoss?(Math.abs(currentAverageLoss)/Math.abs(previousAverageLoss)-1)*100:null;
 const severePosition=avg(severe.map(row=>row.position_change)),regularPosition=avg(races.filter(row=>delta(row)<0&&!severe.includes(row)).map(row=>row.position_change)),severeSof=avg(severe.map(row=>row.sof)),positiveSof=avg(races.filter(row=>delta(row)>0).map(row=>row.sof));
 const findings:Array<{kind:"finding"|"watch"|"data";title:string;text:string}>=[];
 findings.push({kind:"finding",title:"Perdas severas definem o risco da campanha",text:severe.length?String(severe.length)+" de "+String(races.length)+" corridas ("+severeRate.toFixed(1)+"%) perderam mais de "+String(severeThreshold)+" de iRating. Elas concentraram "+severeShare.toFixed(1)+"% de todo o iRating perdido. Na referência, a frequência foi "+previousSevereRate.toFixed(1)+"%."+ (lossSeverityChange!==null?" A perda negativa média ficou "+Math.abs(lossSeverityChange).toFixed(1)+"% "+(lossSeverityChange>0?"mais severa":"menos severa")+" que na referência.":""):"Não houve perdas acima do limiar de "+String(severeThreshold)+" de iRating neste recorte."});
 if(worstRun&&worstRun.races.length>=2)findings.push({kind:"finding",title:"A sequência negativa é o ponto crítico",text:"A pior sequência reuniu "+String(worstRun.races.length)+" perdas consecutivas e consumiu "+signed(worstRun.delta)+" de iRating entre "+new Date(worstRun.races[0].raced_at).toLocaleDateString("pt-BR")+" e "+new Date(worstRun.races[worstRun.races.length-1].raced_at).toLocaleDateString("pt-BR")+". Na referência, a pior sequência foi de "+String(previousWorstRun?.races.length??0)+" corridas e "+signed(previousWorstRun?.delta??0)+" de iRating."});
 else findings.push({kind:"watch",title:"Não houve cadeia longa de perdas",text:"As perdas ficaram isoladas neste período. Na referência, a pior sequência reuniu "+String(previousWorstRun?.races.length??0)+" corridas e "+signed(previousWorstRun?.delta??0)+" de iRating."});
 if(severe.length>=2)findings.push({kind:"finding",title:"O que diferencia as perdas grandes",text:"Nas perdas severas, a variação média foi "+signed(severePosition??0)+" posições e o SoF médio foi "+String(Math.round(severeSof??0))+". Nas demais perdas, a variação foi "+signed(regularPosition??0)+"; nas corridas positivas, o SoF médio foi "+String(Math.round(positiveSof??0))+". Isso separa tamanho da perda, execução em tráfego e força do grid sem presumir causalidade."});
 else findings.push({kind:"data",title:"Amostra pequena de perdas severas",text:"Ainda não há perdas grandes suficientes para separar com confiança efeito de tráfego, posição e SoF."});
 const topLosses=contexts.filter(item=>item.delta<0).slice(0,3).map(item=>({...item,shareOfLosses:totalLoss?round(Math.abs(item.delta)/totalLoss*100):0})),topGains=[...contexts].reverse().filter(item=>item.delta>0).slice(0,3);
 const summary=executiveSummary({scope,races:races.length,baselineRaces:baseline.length,net,previousNet,wins:wins.races,previousWins:previousWins.races,severeCount:severe.length,severeShare,worstRun:worstRun?{length:worstRun.races.length,delta:worstRun.delta}:undefined});
 const action=severe.length||worstRun?.races.length>=2?"Use um protocolo geral de contenção: depois de uma perda acima de "+String(severeThreshold)+" de iRating ou duas perdas seguidas, interrompa novas inscrições. Retorne somente após identificar se houve abandono, perda precoce de posições ou queda de ritmo e completar uma sequência de voltas dentro da sua faixa normal de consistência.":"Mantenha a preparação geral: valide uma sequência de voltas repetíveis antes da corrida e monitore o primeiro sinal de degradação de ritmo, sem condicionar o plano a uma pista específica.";
 return{category,segment:segment??category,label:sectionLabel??(category==="formula_car"?"Formula Car":"Sports Car"),week,confidence:confidence(races,baseline),summary,streakComparison:{current:{gain:gainStreak,loss:lossStreak},reference:{gain:referenceGainStreak,loss:referenceLossStreak}},headline:scope==="week"?"Week "+String(week??"atual")+": "+signed(net)+" de iRating em "+String(races.length)+" corridas.":"Season até agora: "+signed(net)+" de iRating em "+String(races.length)+" corridas.",comparison:baseline.length?"Referência: "+signed(previousNet)+" em "+String(baseline.length)+" corridas; diferença de "+signed(net-previousNet)+".":"Não há amostra equivalente para comparação.",findings,action,severity:{threshold:severeThreshold,count:severe.length,rate:round(severeRate),referenceCount:previousSevere.length,referenceRate:round(previousSevereRate),lossTotal:round(severeTotal),referenceLossTotal:round(previousSevereTotal),shareOfLosses:round(severeShare),referenceShareOfLosses:round(previousSevereShare),averageLoss:round(currentAverageLoss),referenceAverageLoss:round(previousAverageLoss),averageSevereLoss:round(averageSevereLoss),referenceAverageSevereLoss:round(previousAverageSevereLoss),typicalGain:round(averageGain),referenceTypicalGain:round(previousAverageGain),gainsToRecover:round(gainsToRecover),referenceGainsToRecover:round(previousGainsToRecover),worstRunLength:worstRun?.races.length??0,worstRunDelta:round(worstRun?.delta??0),referenceWorstRunLength:previousWorstRun?.races.length??0,referenceWorstRunDelta:round(previousWorstRun?.delta??0)},metrics:{races:races.length,wins:wins.races,podiums,netDelta:round(net),totalIncidents:sum(races.map(row=>row.incidents??0)),averageIncidents:round(avg(races.map(row=>row.incidents))),averagePositionChange:round(avg(races.map(row=>row.position_change))),averageSof:round(avg(races.map(row=>row.sof)),0)},outcomeDistribution:[positive,negative,compare(races,"Neutras",row=>delta(row)===0)],incidentDistribution:[],positionDistribution:[],topLosses,topGains,impactRaces:[...races].sort((a,b)=>Math.abs(delta(b))-Math.abs(delta(a))).slice(0,8).map(row=>({date:row.raced_at,delta:round(delta(row)),finish:row.finish_position,grid:row.grid_position,positionChange:row.position_change,incidents:row.incidents,sof:row.sof,context:row.car_name+" • "+row.track_name,lossShare:delta(row)<0&&totalLoss?round(Math.abs(delta(row))/totalLoss*100):null,severe:delta(row)<-severeThreshold})),weeklyImpact:[...new Set(races.map(row=>row.season_week).filter((value):value is number=>value!==null))].sort((a,b)=>a-b).map(weekNumber=>{const weekRows=races.filter(row=>row.season_week===weekNumber);return{week:weekNumber,races:weekRows.length,delta:round(sum(weekRows.map(delta))),positionChange:round(avg(weekRows.map(row=>row.position_change))),severeLosses:weekRows.filter(row=>delta(row)<-severeThreshold).length}}),raceTrace:races.slice(-24).reverse().map(row=>({date:row.raced_at,delta:round(delta(row)),finish:row.finish_position,grid:row.grid_position,positionChange:row.position_change,incidents:row.incidents,sof:row.sof,context:row.car_name+" • "+row.track_name}))};
}
