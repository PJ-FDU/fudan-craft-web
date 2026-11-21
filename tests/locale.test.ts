import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ABILITIES,statusLabels } from '../src/game/abilities.js';
import { MAPS } from '../src/game/maps.js';
import { RACE_NAMES,STATS,TECHS } from '../src/game/types.js';
import { translate } from '../src/game/locale.js';

test('both languages cover maps, factions, units, technologies and ability states',()=>{
  const labels=[
    ...MAPS.flatMap(m=>[m.name,m.tag,m.description]),...Object.values(RACE_NAMES),
    ...Object.values(STATS).flatMap(s=>[s.name,s.description]),
    ...Object.values(TECHS).flatMap(t=>[t.name,t.description]),
    ...Object.values(ABILITIES).flatMap(a=>[a.name,a.summary,...(a.research?[a.research.name]:[])]),
    ...Object.values(statusLabels),
  ];
  for(const label of labels){
    assert.equal(translate(label,'zh'),label);
    assert.ok(!/\p{Script=Han}/u.test(translate(label,'en')),`missing English: ${label}`);
  }
});

test('dynamic tooltips and command errors translate without changing identifiers or numbers',()=>{
  for(const label of [
    '需要可用的共鸣工坊','需要先研究感染催化','失去覆盖 · 队列暂停',
    '相位屏障 · 30 能量 · 6s 冷却 · 射程 200',
    '原生盾 40 / 60 · 临时盾 25 · 能量 80 / 100',
    '工厂正在换装或已装备该模块','装配站上限为 3 座',
    '选择可见的折跃落点 · × / Esc 取消',
  ])assert.ok(!/\p{Script=Han}/u.test(translate(label,'en')),label);
  assert.equal(translate('已选中 1 个单位','en'),'1 unit selected');
  assert.equal(translate('已选中 3 个单位','en'),'3 units selected');
  assert.equal(translate('lost-temple · P2P · 4330','en'),'lost-temple · P2P · 4330');
});

test('HTML labels cover hidden command modes and touch controls in both languages',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const values=[...html.matchAll(/(?:aria-label|title|placeholder|content|data-label)="([^"]*)"|>([^<>]*)</g)].map(m=>m[1]??m[2]);
  for(const value of values){
    assert.equal(translate(value,'zh'),value);
    assert.ok(!/\p{Script=Han}/u.test(translate(value,'en')),value);
  }
});
