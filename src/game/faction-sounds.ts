import { ABILITIES,ABILITY_IDS,type AbilityId } from './abilities.js';
import { ROSTERS } from './races.js';
import { RACES,STATS,type BuildingKind,type Kind,type Race } from './types.js';

export const FACTION_AUDIO_DIR='factions-v1';
export type FactionLoop=`faction-${Race}-field`|`faction-${Race}-construction`|`faction-${Race}-${BuildingKind}-${'idle'|'work'}`|'faction-relay-assembly-transit';
type BuildingCue='select'|'place'|'finish'|'collapse';
type FactionCue='chirp'|'call'|'order'|'heal'|'loss'|'research'|'alarm'|'victory'|'defeat';
export type FactionEffect=`faction-${Race}-${FactionCue}`|`faction-${Race}-${BuildingKind}-${BuildingCue}`|`faction-${Race}-${Kind}-${'fire'|'impact'}`|`faction-${Race}-skill-${AbilityId}`;
export const fieldLoop=(race:Race)=>`faction-${race}-field` as const;
export const constructionLoop=(race:Race)=>`faction-${race}-construction` as const;
export const buildingLoop=(race:Race,kind:BuildingKind,working:boolean)=>`faction-${race}-${kind}-${working?'work':'idle'}` as const;
export const buildingCue=(race:Race,kind:BuildingKind,cue:BuildingCue)=>`faction-${race}-${kind}-${cue}` as const;
export const factionCue=(race:Race,cue:FactionCue)=>`faction-${race}-${cue}` as const;
export const weaponCue=(race:Race,kind:Kind,phase:'fire'|'impact')=>`faction-${race}-${kind}-${phase}` as const;
export const skillCue=(race:Race,id:AbilityId)=>`faction-${race}-skill-${id}` as const;
export const TRANSIT_LOOP='faction-relay-assembly-transit' as const;
export const factionBuildings=(race:Race):BuildingKind[]=>['base',...ROSTERS[race].buildings];

export const factionWeapons=(race:Race):Kind[]=>
  [...ROSTERS[race].units,...ROSTERS[race].buildings].filter(kind=>STATS[kind].damage>0);

const skillRaces={IND:'industrial',BIO:'brood',ENE:'stellar',RLY:'relay'} as const;
export const FACTION_SKILLS=ABILITY_IDS.filter(id=>ABILITIES[id].target!=='auto').map(id=>({
  id,race:skillRaces[id.slice(0,3) as keyof typeof skillRaces],
}));
export const BUILDING_CUES=['select','place','finish','collapse'] as const;
export const FACTION_CUES=['chirp','call','order','heal','loss','research','alarm','victory','defeat'] as const;

export const FACTION_LOOPS:FactionLoop[]=RACES.flatMap(race=>[
  fieldLoop(race),constructionLoop(race),
  ...factionBuildings(race).flatMap(kind=>[buildingLoop(race,kind,false),buildingLoop(race,kind,true)]),
]);
FACTION_LOOPS.push(TRANSIT_LOOP);
export const FACTION_EFFECTS:FactionEffect[]=[
  ...RACES.flatMap(race=>[
    ...FACTION_CUES.map(cue=>factionCue(race,cue)),
    ...factionBuildings(race).flatMap(kind=>BUILDING_CUES.map(cue=>buildingCue(race,kind,cue))),
    ...factionWeapons(race).flatMap(kind=>[weaponCue(race,kind,'fire'),weaponCue(race,kind,'impact')]),
  ]),
  ...FACTION_SKILLS.map(({race,id})=>skillCue(race,id)),
];
