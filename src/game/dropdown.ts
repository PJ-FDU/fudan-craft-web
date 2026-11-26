export type Choice=readonly [value:string,label:string];

const escapeAttribute=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
export function dropdownMarkup(id:string,label:string,choices:readonly Choice[]=[],value=choices[0]?.[0]??''){
  return `<game-select id="${id}" data-label="${escapeAttribute(label)}" data-choices="${escapeAttribute(JSON.stringify(choices))}" data-value="${escapeAttribute(value)}"></game-select>`;
}

/** The trigger retains keyboard focus while the list highlights an option. */
export class GameSelect extends HTMLElement {
  private trigger=document.createElement('button');
  private text=document.createElement('span');
  private list=document.createElement('div');
  private choices:readonly Choice[]=[];
  private selected=-1;
  private active=-1;
  private listeners?:AbortController;
  private query='';
  private typedAt=0;

  connectedCallback(){
    if(this.contains(this.trigger))return;
    const label=this.dataset.label??'';
    const chevron=document.createElement('span');
    chevron.className='game-select-chevron';
    chevron.setAttribute('aria-hidden','true');
    this.text.className='game-select-value';
    this.trigger.type='button';
    this.trigger.className='game-select-trigger';
    this.trigger.setAttribute('role','combobox');
    this.trigger.setAttribute('aria-label',label);
    this.trigger.setAttribute('aria-expanded','false');
    this.trigger.setAttribute('aria-controls',`${this.id}-choices`);
    this.trigger.append(this.text,chevron);
    this.list.id=`${this.id}-choices`;
    this.list.className='game-select-list';
    this.list.setAttribute('role','listbox');
    this.list.setAttribute('aria-label',label);
    this.list.setAttribute('popover','manual');
    this.list.hidden=true;
    this.append(this.trigger,this.list);
    this.setOptions(JSON.parse(this.dataset.choices??'[]'),this.dataset.value);
    this.trigger.onclick=()=>{
      if(this.listeners)this.close();
      else this.open();
    };
    this.trigger.onkeydown=event=>this.onKey(event);
    // 触屏点击非焦点选项时会先让按钮失焦；由外部焦点/点击关闭，避免选项点击被吞掉。
    this.list.onmousedown=event=>{if((event.target as Element).closest('[role=option]'))event.preventDefault();};
    this.list.onclick=event=>{
      const option=(event.target as Element).closest<HTMLElement>('[data-index]');
      if(option)this.commit(Number(option.dataset.index));
    };
    this.list.onpointerover=event=>{
      if(event.pointerType!=='mouse')return;
      const option=(event.target as Element).closest<HTMLElement>('[data-index]');
      if(option)this.highlight(Number(option.dataset.index),false);
    };
  }

  disconnectedCallback(){this.close();}

  get value(){return this.choices[this.selected]?.[0]??'';}
  set value(value:string){
    const index=this.choices.findIndex(choice=>choice[0]===value);
    if(index>=0)this.select(index);
  }

  get disabled(){return this.trigger.disabled;}
  set disabled(disabled:boolean){
    this.trigger.disabled=disabled;
    if(disabled)this.close();
  }

  setOptions(choices:readonly Choice[],value?:string){
    this.close();
    this.choices=choices;
    this.list.replaceChildren(...choices.map(([,label],index)=>{
      const option=document.createElement('div');
      option.id=`${this.list.id}-${index}`;
      option.setAttribute('role','option');
      option.dataset.index=String(index);
      option.textContent=label;
      return option;
    }));
    this.select(Math.max(0,choices.findIndex(choice=>choice[0]===value)));
  }

  private select(index:number){
    this.selected=index;
    this.text.textContent=this.choices[index]?.[1]??'';
    Array.from(this.list.children).forEach((option,i)=>option.setAttribute('aria-selected',String(i===index)));
  }

  private open(){
    if(this.disabled||!this.choices.length)return;
    this.trigger.focus({preventScroll:true});
    this.list.hidden=false;
    this.list.showPopover?.();
    this.trigger.setAttribute('aria-expanded','true');
    const {signal}=this.listeners=new AbortController();
    document.addEventListener('pointerdown',event=>{if(!event.composedPath().includes(this))this.close();},{signal,capture:true});
    window.addEventListener('scroll',event=>{if(event.target!==this.list)this.position();},{signal,capture:true});
    window.addEventListener('resize',this.position,{signal});
    window.visualViewport?.addEventListener('resize',this.position,{signal});
    window.visualViewport?.addEventListener('scroll',this.position,{signal});
    window.addEventListener('blur',()=>this.close(),{signal});
    document.addEventListener('focusin',event=>{if(!event.composedPath().includes(this))this.close();},{signal});
    this.closest('dialog')?.addEventListener('close',()=>this.close(),{signal});
    this.position();
    this.highlight(this.selected);
  }

  private close(){
    if(!this.listeners)return;
    this.listeners.abort();this.listeners=undefined;
    if(this.list.hidePopover&&this.list.matches(':popover-open'))this.list.hidePopover();
    this.list.hidden=true;
    this.trigger.setAttribute('aria-expanded','false');
    this.trigger.removeAttribute('aria-activedescendant');
    this.list.children.item(this.active)?.removeAttribute('data-active');
    this.active=-1;this.query='';
  }

  private position=()=>{
    const rect=this.trigger.getBoundingClientRect(),visual=window.visualViewport;
    const viewport=visual?.height??document.documentElement.clientHeight,viewportWidth=visual?.width??document.documentElement.clientWidth;
    const top=visual?.offsetTop??0,left=visual?.offsetLeft??0;
    if(!rect.height||rect.bottom<top||rect.top>top+viewport){this.close();return;}
    const gap=6,edge=8;
    const width=Math.min(viewportWidth-edge*2,Math.max(140,rect.width));
    this.list.style.left=`${Math.max(left+edge,Math.min(rect.left,left+viewportWidth-edge-width))}px`;
    this.list.style.width=`${width}px`;
    const below=top+viewport-rect.bottom-gap-edge,above=rect.top-top-gap-edge;
    const opensAbove=below<Math.min(248,this.list.scrollHeight+2)&&above>below;
    this.list.style.maxHeight=`${Math.max(0,Math.min(248,opensAbove?above:below))}px`;
    this.list.style.top=`${Math.max(top+edge,Math.min(opensAbove?rect.top-gap-this.list.offsetHeight:rect.bottom+gap,top+viewport-edge-this.list.offsetHeight))}px`;
  };

  private highlight(index:number,scroll=true){
    const option=this.list.children.item(index) as HTMLElement|null;
    if(!option)return;
    this.list.children.item(this.active)?.removeAttribute('data-active');
    this.active=index;
    option.setAttribute('data-active','');
    this.trigger.setAttribute('aria-activedescendant',option.id);
    if(scroll){
      const start=option.offsetTop,end=start+option.offsetHeight;
      if(start<this.list.scrollTop)this.list.scrollTop=start;
      else if(end>this.list.scrollTop+this.list.clientHeight)this.list.scrollTop=end-this.list.clientHeight;
    }
  }

  private commit(index:number){
    if(!Number.isInteger(index)||index<0||index>=this.choices.length)return;
    const changed=index!==this.selected;
    this.select(index);
    this.close();
    if(changed)this.dispatchEvent(new Event('change',{bubbles:true}));
  }

  private onKey(event:KeyboardEvent){
    if(event.altKey||event.ctrlKey||event.metaKey||event.isComposing||!this.choices.length)return;
    const key=event.key,open=!!this.listeners;
    if(key==='Tab'){this.close();return;}
    if(key==='Escape'&&!open)return;
    const navigation=['ArrowUp','ArrowDown','Home','End'].includes(key);
    if(!navigation&&key!=='Escape'&&key!=='Enter'&&key!==' '&&key.length!==1)return;
    event.preventDefault();event.stopPropagation();
    if(key==='Escape'){this.close();return;}
    if(key==='Enter'||key===' '){if(open)this.commit(this.active);else this.open();return;}
    if(!open)this.open();
    if(navigation){
      const last=this.choices.length-1;
      const index=key==='Home'?0:key==='End'?last:open?this.active+(key==='ArrowDown'?1:-1):this.selected;
      this.highlight(Math.max(0,Math.min(last,index)));
      return;
    }
    const now=performance.now(),letter=key.toLocaleLowerCase();
    this.query=now-this.typedAt<650&&this.query!==letter?this.query+letter:letter;
    this.typedAt=now;
    const options=Array.from(this.list.children);
    const ordered=[...options.slice(this.active+1),...options.slice(0,this.active+1)];
    const match=ordered.find(option=>option.textContent?.toLocaleLowerCase().startsWith(this.query));
    if(match)this.highlight(options.indexOf(match));
  }
}

customElements.define('game-select',GameSelect);
