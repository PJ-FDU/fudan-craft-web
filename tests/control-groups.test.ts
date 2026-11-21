import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupShortcut, readGroups } from '../src/game/control-groups.js';

const key = {key:'1',code:'Digit1',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false};

test('control-group shortcuts use the physical digit under Shift and accept either platform modifier',()=>{
  assert.deepEqual(groupShortcut(key),{key:'1',action:'recall'});
  assert.deepEqual(groupShortcut({...key,ctrlKey:true}),{key:'1',action:'save'});
  assert.deepEqual(groupShortcut({...key,key:'!',shiftKey:true}),{key:'1',action:'add'});
  assert.deepEqual(groupShortcut({...key,key:')',code:'Digit0',metaKey:true,shiftKey:true}),{key:'0',action:'append'});
  assert.deepEqual(groupShortcut({...key,key:'4',code:'Numpad4'}),{key:'4',action:'recall'});
  assert.equal(groupShortcut({...key,key:'ArrowLeft',code:'Numpad4'}),undefined);
  assert.equal(groupShortcut({...key,altKey:true}),undefined);
});

test('saved groups accept only valid numbered slots with unique positive unit IDs',()=>{
  assert.deepEqual([...readGroups({1:[3,3,12,-1,0,'9',3.5],0:[8],7:2,11:[1]})],[['1',[3,12]],['0',[8]]]);
  assert.equal(readGroups(undefined).size,0);
});
