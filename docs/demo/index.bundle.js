var Se={},ho=Symbol("terminator");function $a(e,t){let a=!1,r={error:n,unsubscribe:s,get closed(){return a},signal:Ee(),next(o){if(!a)try{e.next?.(o)}catch(i){n(i)}},complete(){if(!a)try{e.complete?.()}finally{s()}}};e.signal?.subscribe(s);function n(o){if(a)throw o;if(!e.error)throw s(),o;try{e.error(o)}finally{s()}}function s(){a||(a=!0,r.signal.next())}try{if(t?.(r))throw new Error("Unsubscribe function result is deprectaed")}catch(o){n(o)}return r}var E=class{__subscribe;constructor(e){this.__subscribe=e}then(e,t){return Da(this).then(e,t)}pipe(...e){return e.reduce((t,a)=>a(t),this)}subscribe(e){return $a(!e||typeof e=="function"?{next:e}:e,this.__subscribe)}},Ce=class extends E{closed=!1;signal=Ee();observers=new Set;constructor(){super(e=>this.onSubscribe(e))}next(e){if(!this.closed)for(let t of Array.from(this.observers))t.closed||t.next(e)}error(e){if(!this.closed){this.closed=!0;let t=!1,a;for(let r of Array.from(this.observers))try{r.error(e)}catch(n){t=!0,a=n}if(t)throw a}}complete(){this.closed||(this.closed=!0,Array.from(this.observers).forEach(e=>e.complete()),this.observers.clear())}onSubscribe(e){this.closed?e.complete():(this.observers.add(e),e.signal.subscribe(()=>this.observers.delete(e)))}},Sa=class extends E{closed=!1;observers=new Set;constructor(){super(e=>{this.closed?(e.next(),e.complete()):this.observers.add(e)})}next(){if(!this.closed){this.closed=!0;for(let e of Array.from(this.observers))e.closed||(e.next(),e.complete());this.observers.clear()}}},It=class extends Ce{queue=[];emitting=!1;next(e){if(!this.closed)if(this.emitting)this.queue.push(e);else{for(this.emitting=!0,super.next(e);this.queue.length;)super.next(this.queue.shift());this.emitting=!1}}},pt=class extends Ce{currentValue;constructor(e){super(),this.currentValue=e}get value(){return this.currentValue}next(e){this.currentValue=e,super.next(e)}onSubscribe(e){let t=super.onSubscribe(e);return this.closed||e.next(this.currentValue),t}},Ea=class extends Ce{bufferSize;buffer=[];hasError=!1;lastError;constructor(e=1/0){super(),this.bufferSize=e}error(e){this.hasError=!0,this.lastError=e,super.error(e)}next(e){return this.buffer.length===this.bufferSize&&this.buffer.shift(),this.buffer.push(e),super.next(e)}onSubscribe(e){this.observers.add(e),this.buffer.forEach(t=>e.next(t)),this.hasError?e.error(this.lastError):this.closed&&e.complete(),e.signal.subscribe(()=>this.observers.delete(e))}},Ge=class extends Ce{$value=Se;get hasValue(){return this.$value!==Se}get value(){if(this.$value===Se)throw new Error("Reference not initialized");return this.$value}next(e){return this.$value=e,super.next(e)}onSubscribe(e){!this.closed&&this.$value!==Se&&e.next(this.$value),super.onSubscribe(e)}},Ca=class extends Error{message="No elements in sequence"};function Ee(){return new Sa}function ce(...e){return new E(t=>{let a=0,r;function n(){let s=e[a++];s&&!t.closed?(r?.next(),s.subscribe({next:t.next,error:t.error,complete:n,signal:r=Ee()})):t.complete()}t.signal.subscribe(()=>r?.next()),n()})}function Q(e){return new E(t=>{e().subscribe(t)})}function Bt(e){return new E(t=>{for(let a of e)t.closed||t.next(a);t.complete()})}function Ot(e){return new E(t=>{e.then(a=>{t.closed||t.next(a),t.complete()}).catch(a=>t.error(a))})}function Ke(e){return Q(()=>Ot(e()))}function Aa(e){return new E(t=>{for(let a of e)t.closed||t.next(a);t.complete()})}function Pt(e){return e instanceof E?e:Array.isArray(e)?Bt(e):e instanceof Promise?Ot(e):Aa(e)}function I(...e){return Bt(e)}function xn(e){return new Promise((t,a)=>{let r=Se;e.subscribe({next:n=>r=n,error:n=>a(n),complete:()=>t(r)})})}function Da(e){return xn(e).then(t=>t===Se?void 0:t)}function Ae(e,t){return ue(a=>({next:e(a),unsubscribe:t}))}function ue(e){return t=>new E(a=>{let r=e(a,t);a.signal.subscribe(()=>r.unsubscribe?.()),r.error||(r.error=a.error),r.complete||(r.complete=a.complete),r.signal=a.signal,t.subscribe(r)})}function ft(e){return Ae(t=>a=>t.next(e(a)))}function Fa(e,t){return ue(a=>{let r=t,n=0;return{next(s){r=e(r,s,n++)},complete(){a.next(r),a.complete()}}})}function Na(e){return ue(t=>{let a=!0,r;return{next(n){a&&(a=!1,t.next(n),r=setTimeout(()=>a=!0,e))},unsubscribe:()=>clearTimeout(r)}})}function be(e){return new E(t=>{let a=setTimeout(()=>{t.next(),t.complete()},e);t.signal.subscribe(()=>clearTimeout(a))})}function za(e,t=be){return Ht(a=>t(e).map(()=>a))}function Ht(e){return t=>J(a=>{let r=!1,n=!1,s,o=()=>{s?.next(),r=!1,n&&a.complete()},i=Ee();a.signal.subscribe(()=>{o(),i.next()}),t.subscribe({next(l){o(),s=Ee(),r=!0,e(l).subscribe({next:a.next,error:a.error,complete:o,signal:s})},error:a.error,complete(){n=!0,r||a.complete()},signal:i})})}function Ma(e){return t=>J(a=>{let r=a.signal,n=0,s=0,o=!1;t.subscribe({next:i=>{n++,e(i).subscribe({next:a.next,error:a.error,complete:()=>{s++,o&&s===n&&a.complete()},signal:r})},error:a.error,complete(){o=!0,s===n&&a.complete()},signal:r})})}function Ra(e){return ue(t=>{let a=!0;return{next(r){a&&(a=!1,e(r).subscribe({next:t.next,error:t.error,complete:()=>a=!0,signal:t.signal}))}}})}function Xe(e){return Ae(t=>a=>{e(a)&&t.next(a)})}function Ta(e){return Ae(t=>a=>{e-- >0&&!t.closed&&t.next(a),(e<=0||t.closed)&&t.complete()})}function La(e){return Ae(t=>a=>{!t.closed&&e(a)?t.next(a):t.complete()})}function Ia(){let e=!1;return ue(t=>({next(a){e||(e=!0,t.next(a),t.complete())},complete(){t.closed||t.error(new Ca)}}))}function Qe(e){return Ae(t=>a=>{e(a),t.next(a)})}function Ba(e){return ue((t,a)=>{let r,n={next:t.next,error(s){try{if(t.closed)return;let o=e(s,a);o&&(r?.next(),r=Ee(),o.subscribe({...n,signal:r}))}catch(o){t.error(o)}},unsubscribe:()=>r?.next()};return n})}function Oa(){return Ae(e=>{let t=Se;return a=>{a!==t&&(t=a,e.next(a))}})}function Pa(){return e=>{let t=new Ea(1),a=!1;return J(r=>{t.subscribe(r),a||(a=!0,e.subscribe(t))})}}function Ha(){return e=>{let t,a=0;function r(){--a===0&&t?.signal.next()}return J(n=>{n.signal.subscribe(r),a++===0?(t=mt(),t.subscribe(n),e.subscribe(t)):t.subscribe(n)})}}function ja(){return e=>{let t=new Ce,a,r,n=!1,s=!1;return J(o=>{s?(o.next(r),o.complete()):t.subscribe(o),a??=e.subscribe({next:i=>{n=!0,r=i},error:o.error,complete(){s=!0,n&&t.next(r),t.complete()},signal:o.signal})})}}function d(...e){return e.length===1?e[0]:new E(t=>{let a=e.length;for(let r of e)t.closed||r.subscribe({next:t.next,error:t.error,complete(){a--===1&&t.complete()},signal:t.signal})})}function Z(...e){return e.length===0?A:new E(t=>{let a=e.length,r=a,n=0,s=!1,o=new Array(a),i=new Array(a);e.forEach((l,c)=>l.subscribe({next(D){i[c]=D,o[c]||(o[c]=!0,++n>=r&&(s=!0)),s&&t.next(i.slice(0))},error:t.error,complete(){--a<=0&&t.complete()},signal:t.signal}))})}function qa(e){return ue(t=>({next:t.next,unsubscribe:e}))}function _a(){return Xe(()=>!1)}var A=new E(e=>e.complete());function ve(e){return new pt(e)}function J(e){return new E(e)}function jt(){return new Ce}function mt(){return new Ge}var Lt={catchError:Ba,debounceTime:za,distinctUntilChanged:Oa,exhaustMap:Ra,filter:Xe,finalize:qa,first:Ia,ignoreElements:_a,map:ft,mergeMap:Ma,publishLast:ja,reduce:Fa,share:Ha,shareLatest:Pa,switchMap:Ht,take:Ta,takeWhile:La,tap:Qe,throttleTime:Na};for(let e in Lt)E.prototype[e]=function(...t){return this.pipe(Lt[e](...t))};function y(e,t,a){return new E(r=>{let n=r.next.bind(r);e.addEventListener(t,n,a),r.signal.subscribe(()=>e.removeEventListener(t,n,a))})}function Ze(e){return _t(e,{childList:!0})}function qt(e,t){return _t(e,{attributes:!0,attributeFilter:t})}function _t(e,t={attributes:!0,childList:!0}){return new E(a=>{let r=new MutationObserver(n=>n.forEach(s=>{for(let o of s.addedNodes)a.next({type:"added",target:e,value:o});for(let o of s.removedNodes)a.next({type:"removed",target:e,value:o});s.type==="characterData"?a.next({type:"characterData",target:e}):s.attributeName&&a.next({type:"attribute",target:e,value:s.attributeName})}));r.observe(e,t),a.signal.subscribe(()=>r.disconnect())})}function Ut(e){return y(e,"keydown").filter(t=>t.key===" "||t.key==="Enter"?(t.preventDefault(),!0):!1)}function me(e){return y(e,"click")}function Je(e,t){return new E(a=>{let r=new IntersectionObserver(n=>{for(let s of n)a.next(s)},t);r.observe(e),a.signal.subscribe(()=>r.disconnect())})}function De(e){return Je(e).map(t=>t.isIntersecting)}function et(e){return Je(e).filter(t=>t.isIntersecting).first()}function Ua(e){let t;return function(...a){t&&cancelAnimationFrame(t),t=requestAnimationFrame(()=>{e.apply(this,a),t=0})}}function Yt(e){return ue(t=>{let a=Ua(n=>{t.closed||(e&&e(n),t.next(n),r&&t.complete())}),r=!1;return{next:a,complete:()=>r=!0}})}function Vt(){return Q(()=>document.readyState!=="loading"?I(!0):y(window,"DOMContentLoaded").first().map(()=>!0))}function Oe(){return Q(()=>document.readyState==="complete"?I(!0):y(window,"load").first().map(()=>!0))}function Fe(...e){return new E(t=>{let a=new ResizeObserver(r=>r.forEach(n=>t.next(n)));for(let r of e)a.observe(r);t.signal.subscribe(()=>a.disconnect())})}function Wt(e){return e.offsetParent===null&&!(e.offsetWidth&&e.offsetHeight)}function ht(e,t,a){return r=>ce(I(e?r.matches(e):!1),y(r,t).switchMap(()=>d(I(!0),y(r,a).map(()=>e?r.matches(e):!1))))}var bn=ht("","animationstart","animationend"),gt=ht("","mouseenter","mouseleave"),Ya=ht(":focus,:focus-within","focusin","focusout"),xt=e=>Z(gt(e),Ya(e)).map(([t,a])=>t||a);function Pe(e){return e instanceof PointerEvent&&e.pointerType===""||e instanceof MouseEvent&&e.type==="click"&&e.detail===0}function Gt(e){let t=e.getRootNode();return t instanceof Document||t instanceof ShadowRoot?t:void 0}var vn=Qe(e=>console.log(e));E.prototype.log=function(){return this.pipe(vn)};E.prototype.raf=function(e){return this.pipe(Yt(e))};var G=Symbol("bindings"),yn={},He=Symbol("augments"),Ne=Symbol("parser"),Va=class{bindings;messageHandlers;internals;attributes$=new It;wasConnected=!1;wasInitialized=!1;subscriptions;prebind;addMessageHandler(e){(this.messageHandlers??=new Set).add(e)}removeMessageHandler(e){this.messageHandlers?.delete(e)}message(e,t){let a=!1;if(this.messageHandlers)for(let r of this.messageHandlers)r.type===e&&(r.next(t),a||=r.stopPropagation);return a}add(e){if(this.wasConnected)throw new Error("Cannot bind connected component.");this.wasInitialized?(this.bindings??=[]).push(e):(this.prebind??=[]).push(e)}connect(){if(this.wasConnected=!0,!this.subscriptions&&(this.prebind||this.bindings)){let e=this.subscriptions=[];if(this.bindings)for(let t of this.bindings)e.push(t.subscribe());if(this.prebind)for(let t of this.prebind)e.push(t.subscribe())}}disconnect(){this.subscriptions?.forEach(e=>e.unsubscribe()),this.subscriptions=void 0}},at=Symbol("css"),g=class extends HTMLElement{static observedAttributes;static[He];static[Ne];[G]=new Va;[at];connectedCallback(){this[G].wasInitialized=!0,this[G].wasConnected||this.constructor[He]?.forEach(e=>e(this)),this[G].connect()}disconnectedCallback(){this[G].disconnect()}attributeChangedCallback(e,t,a){let r=this.constructor[Ne]?.[e]??wn;t!==a&&(this[e]=r(a,this[e]))}};function wn(e,t){let a=t===!1||t===!0;return e===""?a?!0:"":e===null?a?!1:void 0:e}function Wa(e,t){e.hasOwnProperty(He)||(e[He]=e[He]?.slice(0)??[]),e[He]?.push(t)}var kn={mode:"open"};function U(e){return e.shadowRoot??e.attachShadow(kn)}function Ga(e,t){t instanceof Node?U(e).appendChild(t):e[G].add(t)}function $n(e,t){t.length&&Wa(e,a=>{for(let r of t){let n=r.call(e,a);n&&n!==a&&Ga(a,n)}})}function Sn(e,t){yn[e]=t,customElements.define(e,t)}function u(e,{init:t,augment:a,tagName:r}){if(t)for(let n of t)n(e);a&&$n(e,a),r&&Sn(r,e)}function rt(e){return ce(I(e),e[G].attributes$.map(()=>e))}function H(e,t){return e[G].attributes$.pipe(Xe(a=>a.attribute===t),ft(()=>e[t]))}function v(e,t){return d(H(e,t),Q(()=>I(e[t])))}function En(e){let t=e.observedAttributes;return t&&!e.hasOwnProperty("observedAttributes")&&(t=e.observedAttributes?.slice(0)),e.observedAttributes=t||[]}function bt(e,t,a){return a===!1||a===null||a===void 0?a=null:a===!0&&(a=""),a===null?e.removeAttribute(t):e.setAttribute(t,String(a)),a}function Cn(e,t,a){e.hasOwnProperty(Ne)||(e[Ne]={...e[Ne]}),e[Ne]&&(e[Ne][t]=a)}function f(e,t){return a=>{t?.observe!==!1&&En(a).push(e),t?.parse&&Cn(a,e,t.parse);let r=`$$${e}`,n=a.prototype,s=Object.getOwnPropertyDescriptor(n,e);s&&Object.defineProperty(n,r,s);let o=t?.persist,i={enumerable:!0,configurable:!1,get(){return this[r]},set(l){this[r]!==l?(this[r]=l,o?.(this,e,l),this[G].attributes$.next({target:this,attribute:e,value:l})):s?.set&&(o?.(this,e,l),this[r]=l)}};Wa(a,l=>{if(s||(l[r]=l[e]),Object.defineProperty(l,e,i),o?.(l,e,l[e]),t?.render){let c=t.render(l);c&&Ga(l,c)}})}}function x(e){return f(e,{persist:bt,observe:!0})}function Xt(e){return f(e,{observe:!1})}function N(){return document.createElement("slot")}var Ka=class extends g{};u(Ka,{tagName:"c-span"});function Xa(e,t){let a=document.createTextNode("");return e[G].add(t.tap(r=>a.textContent=r)),a}var Kt=document.createDocumentFragment();function tt(e,t,a=e){if(t!=null)if(Array.isArray(t)){for(let r of t)tt(e,r,Kt);a!==Kt&&a.appendChild(Kt)}else e instanceof g&&t instanceof E?a.appendChild(Xa(e,t)):t instanceof Node?a.appendChild(t):e instanceof g&&typeof t=="function"?tt(e,t(e),a):a.appendChild(document.createTextNode(t))}function Qa(e,t){for(let a in t){let r=t[a];e instanceof g?r instanceof E?e[G].add(a==="$"?r:r.tap(n=>e[a]=n)):a==="$"&&typeof r=="function"?e[G].add(r(e)):e[a]=r:e[a]=r}}function An(e,t){return e.constructor.observedAttributes?.includes(t)}function Qt(e,t){let a=e instanceof g&&An(e,t)?H(e,t):qt(e,[t]).map(()=>e[t]);return d(a,Q(()=>I(e[t])))}function Zt(e,t,a){return f(e,{parse(r){if(r==="Infinity"||r==="infinity")return 1/0;let n=r===void 0?void 0:Number(r);return t!==void 0&&(n===void 0||n<t||isNaN(n))&&(n=t),a!==void 0&&n!==void 0&&n>a&&(n=a),n}})}function ye(e,t,a){for(let r=e.parentElement;r;r=r.parentElement)if(r[G]?.message(t,a))return}function ze(e,t,a=!0){return new E(r=>{let n={type:t,next:r.next,stopPropagation:a};e[G].addMessageHandler(n),r.signal.subscribe(()=>e[G].removeMessageHandler(n))})}function C(e,t,...a){let r=typeof e=="string"?document.createElement(e):new e;return t&&Qa(r,t),a&&tt(r,a),r}function je(e,t,...a){if(e!==je&&typeof e=="function"&&!(e.prototype instanceof g))return a.length&&((t??={}).children=a),e(t);let r=e===je?document.createDocumentFragment():typeof e=="string"?document.createElement(e):new e;return t&&Qa(r,t),a&&tt(r,a),r}var Dn=/([^&=]+)=?([^&]*)/g,Fn=/:([\w_$@]+)/g,Nn=/\/\((.*?)\)/g,zn=/(\(\?)?:\w+/g,Mn=/\*\w+/g,Rn=/[-{}[\]+?.,\\^$|#\s]/g,Tn=/([^#]*)(?:#(.+))?/,Jt="@@cxlRoute",ee={location:window.location,history:window.history};function Ln(e){let t=[];return[new RegExp("^/?"+e.replace(Rn,"\\$&").replace(Nn,"\\/?(?:$1)?").replace(zn,function(a,r){return t.push(a.substr(1)),r?a:"([^/?]*)"}).replace(Mn,"([^?]*?)")+"(?:/$|\\?|$)"),t]}function ea(e){return e[0]==="/"&&(e=e.slice(1)),e.endsWith("/")&&(e=e.slice(0,-1)),e}function yt(e,t){return t?e.replace(Fn,(a,r)=>t[r]||""):e}function Za(e){let t={},a;for(;a=Dn.exec(e);)t[a[1]]=decodeURIComponent(a[2]);return t}var In=class{path;regex;parameters;constructor(e){this.path=e=ea(e),[this.regex,this.parameters]=Ln(e)}_extractQuery(e){let t=e.indexOf("?");return t===-1?{}:Za(e.slice(t+1))}getArguments(e){let t=this.regex.exec(e),a=t&&t.slice(1);if(!a)return;let r=this._extractQuery(e);return a.forEach((n,s)=>{let o=s===a.length-1?n||"":n?decodeURIComponent(n):"";r[this.parameters[s]]=o}),r}test(e){return this.regex.test(e)}toString(){return this.path}},Ja=class{id;path;parent;redirectTo;definition;isDefault;constructor(e){if(e.path!==void 0)this.path=new In(e.path);else if(!e.id)throw console.log(e),new Error("An id or path is mandatory. You need at least one to define a valid route.");this.id=e.id||(e.path??`route${Math.random().toString()}`),this.isDefault=e.isDefault||!1,this.parent=e.parent,this.redirectTo=e.redirectTo,this.definition=e}create(e){let t=this.definition.render();t[Jt]=this;for(let a in e)e[a]!==void 0&&(t[a]=e[a]);return t}},er=class{routes=[];defaultRoute;findRoute(e){return this.routes.find(t=>t.path?.test(e))??this.defaultRoute}get(e){return this.routes.find(t=>t.id===e)}register(e){if(e.isDefault){if(this.defaultRoute)throw new Error("Default route already defined");this.defaultRoute=e}this.routes.unshift(e)}};function tr(e){return e[Jt]}function Me(e){let t=Tn.exec(e);return{path:ea(t?.[1]||""),hash:t?.[2]||""}}var ar={getHref(e){return e=typeof e=="string"?Me(e):e,`${ee.location.pathname}${e.path?`?${e.path}`:""}${e.hash?`#${e.hash}`:""}`},serialize(e){let t=ee.history.state?.url;if(!t||e.hash!==t.hash||e.path!==t.path){let a=this.getHref(e);a!==`${location.pathname}${location.search}${location.hash}`&&ee.history.pushState({url:e},"",a)}},deserialize(){return{path:ee.location.search.slice(1),hash:ee.location.hash.slice(1)}}},rr={getHref(e){return e=typeof e=="string"?Me(e):e,`${e.path}${e.hash?`#${e.hash}`:""}`},serialize(e){let t=ee.history.state?.url;if(!t||e.hash!==t.hash||e.path!==t.path){let a=this.getHref(e);a!==`${location.pathname}${location.search}${location.hash}`&&ee.history.pushState({url:e},"",a||"/")}},deserialize(){return{path:ee.location.pathname,hash:ee.location.hash.slice(1)}}},ta={getHref(e){return e=typeof e=="string"?Me(e):e,`#${e.path}${e.hash?`#${e.hash}`:""}`},serialize(e){let t=ta.getHref(e);ee.location.hash!==t&&(ee.location.hash=t)},deserialize(){return Me(ee.location.hash.slice(1))}},aa={hash:ta,path:rr,query:ar},nr=class{callbackFn;state;routes=new er;instances={};root;lastGo;constructor(e){this.callbackFn=e}getState(){if(!this.state)throw new Error("Invalid router state");return this.state}route(e){let t=new Ja(e);return this.routes.register(t),t}go(e){this.lastGo=e;let t=typeof e=="string"?Me(e):e,a=t.path,r=this.state?.url;if(a!==r?.path){let n=this.routes.findRoute(a);if(!n)throw new Error(`Path: "${a}" not found`);let s=n.path?.getArguments(a);if(n.redirectTo)return this.go(yt(n.redirectTo,s));let o=this.execute(n,s);if(this.lastGo!==e)return;if(!this.root)throw new Error(`Route: "${a}" could not be created`);this.updateState({url:t,arguments:s,route:n,current:o,root:this.root})}else this.state&&t.hash!=r?.hash&&this.updateState({...this.state,url:t})}getPath(e,t){let a=this.routes.get(e),r=a&&a.path;return r&&yt(r.toString(),t)}isActiveUrl(e){let t=Me(e);if(!this.state?.url)return!1;let a=this.state.url;return!!Object.values(this.instances).find(r=>{let n=r[Jt],s=this.state?.arguments;if(n?.path?.test(t.path)&&(!t.hash||t.hash===a.hash)){if(s){let o=n.path.getArguments(t.path);for(let i in o)if(s[i]!=o[i])return!1}return!0}return!1})}updateState(e){this.state=e,this.callbackFn?.(e)}findRoute(e,t){let a=this.instances[e],r;if(a)for(r in t){let n=t[r];n!==void 0&&(a[r]=n)}return a}executeRoute(e,t,a){let r=e.parent,n=r&&this.routes.get(r),s=e.id,o=n&&this.executeRoute(n,t,a),i=this.findRoute(s,t)||e.create(t);return o?i&&i.parentNode!==o&&o.appendChild(i):this.root=i,a[s]=i,i}discardOldRoutes(e){let t=this.instances;for(let a in t){let r=t[a];e[a]!==r&&(r.parentNode?.removeChild(r),delete t[a])}}execute(e,t){let a={},r=this.executeRoute(e,t||{},a);return this.discardOldRoutes(a),this.instances=a,r}},qe=new Ge,ra=new Ge,oe=new nr(()=>qe.next());function or(e,t=aa.query){return d(J(()=>ra.next(t)),e.tap(()=>oe.go(t.deserialize())),qe.tap(()=>t.serialize(oe.getState().url))).catchError(a=>{if(a?.name==="SecurityError")return A;throw a})}function sr(){return ce(I(location.hash.slice(1)),y(window,"hashchange").map(()=>location.hash.slice(1)))}var vt;function ir(){if(!vt){vt=new pt(history.state);let e=history.pushState;history.pushState=function(...t){let a=e.apply(this,t);return history.state&&(history.state.lastAction="push"),vt.next(history.state),a}}return d(y(window,"popstate").map(()=>(history.state&&(history.state.lastAction="pop"),history.state)),vt)}function lr(){let e;return d(sr(),ir()).map(()=>window.location).filter(t=>{let a=t.href!==e;return e=t.href,a})}var Bn=qe.raf().map(()=>{let e=[],t=oe.getState(),a=t.current;do a.routeTitle&&e.unshift({title:a.routeTitle,first:a===t.current,path:On(a)});while(a=a.parentNode);return e});function On(e){let t=tr(e);return t&&yt(t.path?.toString()||"",oe.state?.arguments||{})}function na(e,t,a=t){return d(Z(ra,rt(e)).tap(([r])=>{e.href!==void 0&&(t.href=e.external?e.href:r.getHref(e.href)),t.target=e.target||""}),me(t).tap(r=>{e.target||r.preventDefault()}),me(a).tap(()=>{e.href!==void 0&&!e.target&&(e.external?location.assign(e.href):oe.go(e.href))}))}function Pn(e,t){let a=document.createElement("div");return a.style.display="contents",a.routeTitle=t,a.appendChild(e.content.cloneNode(!0)),a}var cr=class extends g{strategy="query";get state(){return oe.state}go(e){return oe.go(e)}};u(cr,{tagName:"c-router",init:[f("strategy")],augment:[e=>{function t(a){let r=a.dataset;if(r.registered)return;r.registered="true";let n=r.title||void 0;oe.route({path:r.path,id:r.id||void 0,parent:r.parent||void 0,isDefault:a.hasAttribute("data-default"),redirectTo:r.redirectto,render:Pn.bind(null,a,n)})}return Oe().switchMap(()=>{for(let a of Array.from(e.children))a instanceof HTMLTemplateElement&&t(a);return d(Ze(e).tap(a=>{a.type==="added"&&a.value instanceof HTMLTemplateElement&&t(a.value)}),v(e,"strategy").switchMap(a=>{let r=aa[a];return or(lr(),r).catchError((n,s)=>(console.error(n),s))}))})}]});function wt(e,t){if(t==="_parent")return e.parentElement||void 0;if(t==="_next")return e.nextElementSibling||void 0;if(typeof t!="string")return t??void 0;let a,r=e.getRootNode();return r instanceof ShadowRoot&&(a=r.getElementById(t),a)?a:e.ownerDocument.getElementById(t)??void 0}var nt=m(":host{display:contents}"),fr=[-2,-1,0,1,2,3,4,5],ia=["display-large","display-medium","display-small","body-large","body-medium","body-small","label-large","label-medium","label-small","headline-large","headline-medium","headline-small","title-large","title-medium","title-small","code"],_e=mt(),la=ve(""),Te=m(`:host([disabled]) {
	cursor: default;
	pointer-events: var(--cxl-override-pointer-events, none);
}`),jn=(()=>{for(let e of Array.from(document.fonts.keys()))if(e.family==="Roboto")return!0;return!1})(),mr={primary:"#186584","on-primary":"#FFFFFF","primary-container":"#C1E8FF","on-primary-container":"#004D67",secondary:"#4E616C","on-secondary":"#FFFFFF","secondary-container":"#D1E6F3","on-secondary-container":"#364954",tertiary:"#5F5A7D","on-tertiary":"#FFFFFF","tertiary-container":"#E5DEFF","on-tertiary-container":"#474364",error:"#BA1A1A","on-error":"#FFFFFF","error-container":"#FFDAD6","on-error-container":"#93000A",background:"#F6FAFE","on-background":"#171C1F",surface:"#F6FAFE","on-surface":"#171C1F","surface-variant":"#DCE3E9","on-surface-variant":"#40484D",outline:"#71787D","outline-variant":"#C0C7CD",shadow:"#000000",scrim:"#000000","inverse-surface":"#2C3134","on-inverse-surface":"#EDF1F5","inverse-primary":"#8ECFF2","primary-fixed":"#C1E8FF","on-primary-fixed":"#001E2B","primary-fixed-dim":"#8ECFF2","on-primary-fixed-variant":"#004D67","secondary-fixed":"#D1E6F3","on-secondary-fixed":"#091E28","secondary-fixed-dim":"#B5C9D7","on-secondary-fixed-variant":"#364954","tertiary-fixed":"#E5DEFF","on-tertiary-fixed":"#1B1736","tertiary-fixed-dim":"#C9C2EA","on-tertiary-fixed-variant":"#474364","surface-dim":"#D6DADE","surface-bright":"#F6FAFE","surface-container-lowest":"#FFFFFF","surface-container-low":"#F0F4F8","surface-container":"#EAEEF2","surface-container-high":"#E5E9ED","surface-container-highest":"#DFE3E7",warning:"#DD2C00","on-warning":"#FFFFFF","warning-container":"#FFF4E5","on-warning-container":"#8C1D18",success:"#2E7D32","on-success":"#FFFFFF","success-container":"#81C784","on-success-container":"#000000"};function qn(e=mr){return Object.entries(e).map(([t,a])=>`--cxl-color--${t}:${a};--cxl-color-${t}:var(--cxl-color--${t});`).join("")}var B={name:"",animation:{flash:{kf:{opacity:[1,0,1,0,1]},options:{easing:"ease-in"}},spin:{kf:{rotate:["0deg","360deg"]}},pulse:{kf:{rotate:["0deg","360deg"]},options:{easing:"steps(8)"}},openY:{kf:e=>({height:["0",`${e.scrollHeight}px`]})},closeY:{kf:e=>({height:[`${e.scrollHeight}px`,"0"]})},expand:{kf:{scale:[0,1]}},expandX:{kf:{scale:["0 1","1 1"]}},expandY:{kf:{scale:["1 0","1 1"]}},zoomIn:{kf:{scale:[.3,1]}},zoomOut:{kf:{scale:[1,.3]}},scaleUp:{kf:{scale:[1,1.25]}},fadeIn:{kf:[{opacity:0},{opacity:1}]},fadeOut:{kf:[{opacity:1},{opacity:0}]},shakeX:{kf:{translate:["0","-10px","10px","-10px","10px","-10px","10px","-10px","10px","0"]}},shakeY:{kf:{translate:["0","0 -10px","0 10px","0 -10px","0 10px","0 -10px","0 10px","0 -10px","0 10px","0"]}},slideOutLeft:{kf:{translate:["0","-100% 0"]}},slideInLeft:{kf:{translate:["-100% 0","0"]}},slideOutRight:{kf:{translate:["0","100% 0"]}},slideInRight:{kf:{translate:["100% 0","0"]}},slideInUp:{kf:{translate:["0 100%","0"]}},slideInDown:{kf:{translate:["0 -100%","0"]}},slideOutUp:{kf:{translate:["0","0 -100%"]}},slideOutDown:{kf:{translate:["0","0 100%"]}},focus:{kf:[{offset:.1,filter:"brightness(150%)"},{filter:"brightness(100%)"}],options:{duration:500}}},easing:{emphasized:"cubic-bezier(0.2, 0.0, 0, 1.0)",emphasized_accelerate:"cubic-bezier(0.05, 0.7, 0.1, 1.0)",emphasized_decelerate:"cubic-bezier(0.3, 0.0, 0.8, 0.15)",standard:"cubic-bezier(0.2, 0.0, 0, 1.0)",standard_accelerate:"cubic-bezier(0, 0, 0, 1)",standard_decelerate:"cubic-bezier(0.3, 0, 1, 1)"},breakpoints:{xsmall:0,small:600,medium:905,large:1240,xlarge:1920,xxlarge:2560},disableAnimations:!1,prefersReducedMotion:window.matchMedia("(prefers-reduced-motion: reduce)").matches,colors:mr,imports:jn?void 0:["https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400&family=Roboto:wght@300;400;500;700&display=swap"],globalCss:`:root{
--cxl-color-scrim: rgb(29 27 32 / 0.5); /* neutral 10? #1D1B20 */

--cxl-font-family: Roboto;
--cxl-font-monospace:"Roboto Mono", monospace;

--cxl-font-display-large: 400 57px/64px var(--cxl-font-family);
--cxl-letter-spacing-display-large: -0.25px;
--cxl-font-display-medium: 400 45px/52px var(--cxl-font-family);
--cxl-letter-spacing-display-medium: 0;
--cxl-font-display-small: 400 36px/44px var(--cxl-font-family);
--cxl-letter-spacing-display-small: 0;
--cxl-font-headline-large: 400 32px/40px var(--cxl-font-family);
--cxl-letter-spacing-headline-large: -0.25px;
--cxl-font-headline-medium: 400 28px/36px var(--cxl-font-family);
--cxl-letter-spacing-headline-medium: 0;
--cxl-font-headline-small: 400 24px/32px var(--cxl-font-family);
--cxl-letter-spacing-headline-small: 0;
--cxl-font-title-large: 400 22px/28px var(--cxl-font-family);
--cxl-letter-spacing-title-large: 0;
--cxl-font-title-medium: 500 16px/24px var(--cxl-font-family);
--cxl-letter-spacing-title-medium: 0.15px;
--cxl-font-title-small: 500 14px/20px var(--cxl-font-family);
--cxl-letter-spacing-title-small: 0.1px;
--cxl-font-body-large: 400 16px/24px var(--cxl-font-family);
--cxl-letter-spacing-body-large: normal;
--cxl-font-body-medium: 400 14px/20px var(--cxl-font-family);
--cxl-letter-spacing-body-medium: 0.25px;
--cxl-font-body-small: 400 12px/16px var(--cxl-font-family);
--cxl-letter-spacing-body-small: 0.4px;
--cxl-font-label-large: 500 14px/18px var(--cxl-font-family);
--cxl-letter-spacing-label-large: 0.1px;
--cxl-font-label-medium: 500 12px/16px var(--cxl-font-family);
--cxl-letter-spacing-label-medium: 0.5px;
--cxl-font-label-small: 500 11px/16px var(--cxl-font-family);
--cxl-letter-spacing-label-small: 0.5px;
--cxl-font-code:400 14px var(--cxl-font-monospace);
--cxl-letter-spacing-code: 0.2px;

--cxl-font-weight-bold: 700;
--cxl-font-weight-label-large-prominent: var(--cxl-font-weight-bold);

--cxl-speed:200ms;

--cxl-elevation-1: rgb(0 0 0 / .2) 0 2px 1px -1px, rgb(0 0 0 / .14) 0 1px 1px 0, rgb(0 0 0 / .12) 0px 1px 3px 0;
--cxl-elevation-2: rgb(0 0 0 / .2) 0 3px 3px -2px, rgb(0 0 0 / .14) 0 3px 4px 0, rgb(0 0 0 / .12) 0px 1px 8px 0;
--cxl-elevation-3: rgba(0, 0, 0, 0.2) 0px 3px 3px -2px, rgba(0, 0, 0, 0.14) 0px 3px 4px 0px, rgba(0, 0, 0, 0.12) 0px 1px 8px 0px;;
--cxl-elevation-4: rgba(0, 0, 0, 0.2) 0px 3px 3px -2px, rgba(0, 0, 0, 0.14) 0px 3px 4px 0px, rgba(0, 0, 0, 0.12) 0px 1px 8px 0px;
--cxl-elevation-5: rgba(0, 0, 0, 0.2) 0px 3px 3px -2px, rgba(0, 0, 0, 0.14) 0px 3px 4px 0px, rgba(0, 0, 0, 0.12) 0px 1px 8px 0px;

--cxl-shape-corner-xlarge: 28px;
--cxl-shape-corner-large: 16px;
--cxl-shape-corner-medium: 12px;
--cxl-shape-corner-small: 8px;
--cxl-shape-corner-xsmall: 4px;
--cxl-shape-corner-full: 50vh;
}
	`,css:""};function kt(e=""){return`:host ${e} {
--cxl-mask-hover: color-mix(in srgb, var(--cxl-color-on-surface) 8%, transparent);
--cxl-mask-focus: color-mix(in srgb, var(--cxl-color-on-surface) 10%, transparent);
--cxl-mask-active: linear-gradient(0, var(--cxl-color-surface-container),var(--cxl-color-surface-container));
}
:host(:hover) ${e} { background-image: linear-gradient(0, var(--cxl-mask-hover),var(--cxl-mask-hover)); }
:host(:focus-visible) ${e} { background-image: linear-gradient(0, var(--cxl-mask-focus),var(--cxl-mask-focus)) }
:host{-webkit-tap-highlight-color: transparent}
`}var ot=m(kt()),$t=[0,4,8,16,24,32,48,64];var ur,_n;function de(e,t){return e==="xsmall"?`@media(max-width:${B.breakpoints.small}px){${t}}`:`@media(min-width:${B.breakpoints[e]}px){${t}}`}function st(e){return Fe(e).map(t=>{let a=B.breakpoints,r=t.contentRect.width,n="xsmall";for(let s in a){if(a[s]>r)return n;n=s}return n})}function Un(e=""){return Object.entries(ua).map(([t,a])=>`:host([color=${t}]) ${e}{ ${a} }`).join("")}function Le(e,t,a=""){return ca(e,`
		${t?`:host ${a} { ${ua[t]} }`:""}
		:host${t?"":"([color])"} ${a} {
			color: var(--cxl-color-on-surface);
			background-color: var(--cxl-color-surface);
		}
		:host([color=transparent]) ${a}{
			color: inherit;
			background-color: transparent;
		}
		${Un(a)}
	`)}function ca(e,t){let a=m(t);return f(e,{persist:bt,render:r=>a(r)})}function he(e,t){return ca(e,fr.map(a=>{let r=t(a);return a===0?`:host ${r}`:`:host([size="${a}"]) ${r}`}).join(""))}function hr(e){let t;return _e.tap(a=>{let r=a?.theme.override?.[e.tagName];r?t?t.replace(r):e.shadowRoot?.adoptedStyleSheets.push(t??=Re(r)):t&&t.replace("")})}function Re(e){let t=new CSSStyleSheet;return e&&t.replaceSync(e),t}function m(e){let t;return a=>{let r=U(a);if(r.adoptedStyleSheets.push(t??=Re(e)),!a[at])return B.css&&r.adoptedStyleSheets.unshift(_n??=Re(B.css)),a[at]=!0,hr(a)}}var gr=["background","primary","primary-container","secondary","secondary-container","tertiary","tertiary-container","surface","surface-container","surface-container-low","surface-container-lowest","surface-container-highest","surface-container-high","error","error-container","success","success-container","warning","warning-container","inverse-surface","inverse-primary"],Yn=[...gr,"inherit"];function oa(e,t="surface"){return`--cxl-color-${t}: var(--cxl-color--${e});
--cxl-color-on-${t}: var(--cxl-color--on-${e}, var(--cxl-color--on-surface));
--cxl-color-surface-variant: var(--cxl-color--${e==="surface"?"surface-variant":e});
--cxl-color-on-surface-variant: ${e.includes("surface")?"var(--cxl-color--on-surface-variant)":`color-mix(in srgb, var(--cxl-color--on-${e}) 80%, transparent)`};
`}function pe(e){return`${oa(e)};background-color:var(--cxl-color-surface);color:var(--cxl-color-on-surface);`}var ua=gr.reduce((e,t)=>(e[t]=`
${oa(t)}
${t==="inverse-surface"?oa("inverse-primary","primary"):""}
`,e),{inherit:"color:inherit;background-color:inherit;"});function Ie(e=":host"){return`
		${e} {
			scrollbar-color: var(--cxl-color-outline-variant) var(--cxl-color-surface, transparent);
		}
		${e}::-webkit-scrollbar-track {
			background-color: var(--cxl-color-surface, transparent);
		}
	`}function z(e){return`font:var(--cxl-font-${e});letter-spacing:var(--cxl-letter-spacing-${e});`}var Vn=requestAnimationFrame(()=>vr()),Wn={},dr=document.createElement("template"),pr={};function xr(e){return function(t){let a=e(t),r=pr[a];if(r)return r.cloneNode(!0);let n=document.createElementNS("http://www.w3.org/2000/svg","svg"),s=()=>(n.dispatchEvent(new ErrorEvent("error")),"");return fetch(a).then(o=>o.ok?o.text():s(),s).then(o=>{if(!o)return;dr.innerHTML=o;let i=dr.content.children[0];if(!i)return;let l=i.getAttribute("viewBox");l?n.setAttribute("viewBox",l):i.hasAttribute("width")&&i.hasAttribute("height")&&n.setAttribute("viewBox",`0 0 ${i.getAttribute("width")} ${i.getAttribute("height")}`);for(let c of i.childNodes)n.append(c);pr[t.name]=n}),n.setAttribute("fill","currentColor"),n}}var Gn=xr(({name:e,width:t,fill:a})=>(t!==20&&t!==24&&t!==40&&t!==48&&(t=48),`https://cdn.jsdelivr.net/gh/google/material-design-icons@941fa95/symbols/web/${e}/materialsymbolsoutlined/${e}_${a?"fill1_":""}${t}px.svg`)),Kn=Gn;function da(e,t={}){let{width:a,height:r}=t;a===void 0&&r===void 0&&(a=r=24);let n=Wn[e]?.icon()||Kn({name:e,width:a,fill:t.fill});return t.className&&n.setAttribute("class",t.className),a&&(n.setAttribute("width",`${a}`),r===void 0&&n.setAttribute("height",`${a}`)),r&&(n.setAttribute("height",`${r}`),a===void 0&&n.setAttribute("width",`${r}`)),t.alt&&n.setAttribute("alt",t.alt),n}var sa,br=new Promise(e=>{sa=e});function vr(e){cancelAnimationFrame(Vn),ur||(e&&(e.colors&&(B.colors=e.colors),e.globalCss&&(B.globalCss+=e.globalCss)),document.adoptedStyleSheets.push(ur=Re(`:root { ${qn(B.colors)} }`+B.globalCss)),B.imports?Promise.allSettled(B.imports.map(t=>{let a=document.createElement("link");return a.rel="stylesheet",a.href=t,document.head.append(a),new Promise((r,n)=>(a.onload=r,a.onerror=n))})).then(sa):sa())}function it(){return Ke(async()=>{await br,await document.fonts.ready})}function St(e,t=e){return d(yr(e,t).ignoreElements(),qe.map(()=>e.href!==void 0&&oe.isActiveUrl(e.href)))}function yr(e,t=e){let a=C("a",{tabIndex:-1,className:"link",ariaLabel:"link"});return a.style.cssText=`
text-decoration: none;
outline: 0;
display: block;
position: absolute;
left: 0;
right: 0;
bottom: 0;
top: 0;
	`,U(e).append(a),d(na(e,a),y(a,"click").tap(r=>{r.stopPropagation(),Pe(r)||e.dispatchEvent(new PointerEvent(r.type,r)),ye(e,"toggle.close",void 0)}),me(t).tap(r=>{Pe(r)&&a.click()}))}var wr=class extends g{href};u(wr,{tagName:"c-router-selectable",init:[f("href")],augment:[nt,()=>C("slot"),e=>Q(()=>{let t=e.parentElement;return St(e,t).raf(a=>{t.selected=a})})]});function kr(e,t,a){return new E(r=>{let n={id:e,controller:a,target:t};ye(t,`registable.${e}`,n),r.signal.subscribe(()=>n.unsubscribe?.())})}function $r(e){return e in B.animation}function ge({target:e,animation:t,options:a}){if(B.disableAnimations)return e.animate(null);let r=typeof t=="string"?B.animation[t]:t;if(!r)throw new Error(`Animation "${t}" not defined`);let n=typeof r.kf=="function"?r.kf(e):r.kf,s={duration:250,easing:B.easing.emphasized,...r.options,...a,...B.prefersReducedMotion?{duration:0}:void 0};return e.animate(n,s)}function Sr(e){let{trigger:t,stagger:a,commit:r,keep:n}=e;function s(i){return new E(l=>{let c=ge(i);c.ready.then(()=>l.next({type:"start",animation:c}),()=>{}),c.addEventListener("finish",()=>{l.next({type:"end",animation:c}),r&&c.commitStyles(),!(n||n!==!1&&i.options?.fill&&(i.options.fill==="both"||i.options.fill==="forwards"))&&l.complete()}),l.signal.subscribe(()=>{try{c.cancel()}catch{}})})}let o=Array.isArray(e.target)?e.target:e.target instanceof Element?[e.target]:Array.from(e.target);return d(...o.map((i,l)=>{let c={...e.options,delay:a!==void 0?(e.options?.delay??0)+l*a:e.options?.delay};return(t==="visible"?De(i).filter(D=>D):t==="hover"?gt(i):I(!0)).switchMap(D=>D?s({...e,options:c,target:i}):A)}))}function Er(e,t,a=e.getBoundingClientRect()){let r=a.width>a.height?a.width:a.height,n=new Dr,s=e.shadowRoot||e,{x:o,y:i}=t??{},l=o===void 0||!t||Pe(t),c=o>a.right||o<a.left||i>a.bottom||i<a.top;return n.x=l||c?a.width/2:o-a.left,n.y=l||c?a.height/2:i-a.top,n.radius=r,t||(n.duration=0),s.prepend(n),n}function Cr(e,t=e){let a,r,n,s=()=>{a=Er(t,r instanceof Event?r:void 0,n),a.duration=600,r=void 0};return d(y(e,"click").tap(o=>{r=o,n=t.getBoundingClientRect()}),v(e,"selected").raf().switchMap(()=>{if(e.selected){if(!a?.parentNode){if(Wt(e))return r=void 0,et(e).tap(s);s()}}else a&&Ar(a);return A})).ignoreElements()}function Ar(e){return new Promise(t=>{ge({target:e,animation:"fadeOut"}).addEventListener("finish",()=>{e.remove(),t()})})}function we(e,t=e){let a=!1,r=0;return d(y(t,"pointerdown"),y(t,"click")).tap(n=>n.cxlRipple??=e).raf().mergeMap(n=>{if(n.cxlRipple===e&&!a&&!e.disabled&&e.parentNode){r=Date.now(),a=!0,e.style.setProperty("--cxl-mask-hover","none");let s=Er(e,n),o=s.duration,i=()=>{e.style.removeProperty("--cxl-mask-hover"),Ar(s).then(()=>{a=!1})};return n.type==="click"?be(o).tap(i):d(y(document,"pointerup"),y(document,"pointercancel")).first().map(()=>{let l=Date.now()-r;setTimeout(()=>i(),l>o?32:o-l)})}return A})}var Dr=class extends g{x=0;y=0;radius=0;duration=500};u(Dr,{tagName:"c-ripple",init:[f("x"),f("y"),f("radius")],augment:[m(`
:host {
	display: block;
	position: absolute;
	overflow: hidden;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	pointer-events: none;
	direction: ltr;
}
.ripple {
	position: relative;
	background-image: inherit;
	border-radius: 100%;
	background-color: var(--cxl-color-ripple, color-mix(in srgb, var(--cxl-color-on-surface) 16%, transparent));
}`),e=>{let t=document.createElement("div");return t.className="ripple",J(()=>{let a=t.style;a.translate=`${e.x-e.radius}px ${e.y-e.radius}px`,a.width=a.height=e.radius*2+"px",t.parentNode||U(e).append(t),ge({target:t,animation:"expand",options:{duration:e.duration}}),ge({target:t,animation:"fadeIn",options:{duration:e.duration/2}})})}]});function Fr(e){return v(e,"disabled").tap(t=>t?e.setAttribute("aria-disabled","true"):e.removeAttribute("aria-disabled"))}function Nr(e,t=e,a=0){let r=t.hasAttribute("tabindex")?t.tabIndex:a;return Fr(e).tap(n=>{n?t.removeAttribute("tabindex"):t.tabIndex=r})}function zr(e,t=e){return d(y(t,"focusout").tap(()=>e.touched=!0),d(H(e,"disabled"),H(e,"touched")).tap(()=>ye(e,"focusable.change")))}function lt(e,t=e,a=0){return d(Nr(e,t,a),zr(e,t))}function Xn(e,t){return a=>new E(()=>{a.hasAttribute(e)||a.setAttribute(e,t)})}function se(e){return Xn("role",e)}var Qn=0;function pa(e){return Qt(e,"id").map(t=>(t||(e.id=`cxl__${Qn++}`),e.id))}var Ue=[Te,ot,m(`
:host {
	box-sizing: border-box;
	position: relative;
	transition: box-shadow var(--cxl-speed);
}
:host(:hover) {
	box-shadow: var(--cxl-elevation-1);
}
:host(:active) { box-shadow: var(--cxl-elevation-0); }
:host(:focus-visible) {
	outline: 3px auto var(--cxl-color-secondary);
}
:host([disabled]) {
	background-color: color-mix(in srgb, var(--cxl-color--on-surface) 12%, transparent);
	color: color-mix(in srgb, var(--cxl-color--on-surface) 38%, transparent);
}
:host([variant=elevated]) {
	--cxl-color-surface: var(--cxl-color--surface-container-low);
	box-shadow: var(--cxl-elevation-1);
}
:host([variant=elevated]:hover) {
	box-shadow: var(--cxl-elevation-2);
}
:host([variant=elevated]:active) {
	box-shadow: var(--cxl-elevation-1);
}
:host([variant=elevated][disabled]) { box-shadow: none; }
:host([variant=outlined][disabled]) {
	border-color: color-mix(in srgb, var(--cxl-color-on-surface) 12%, transparent);
}	
:host([variant=outlined][disabled]),:host([variant=text][disabled]) {
	background-color: transparent;
	box-shadow: none;
}`)],Mr=m(`
:host {
	${z("label-large")}
	user-select: none;
	cursor: pointer;
	overflow: hidden;
	display: inline-flex;
	justify-content: center;
	align-items: center;
	column-gap: 8px;
	line-height: unset;
	white-space: nowrap;
	border-radius: var(--cxl-shape-corner-full);
	align-self: center;
}
:host([variant=outlined]:hover),:host([variant=text]:hover) {
	box-shadow: none;
}
:host([variant=text]) { margin: -10px -12px; }
:host([variant=text]:not([disabled])) {
	background-color: transparent;
	color: var(--cxl-color-primary);
}
:host([variant=text]),:host([variant=outlined]) {
	--cxl-color-on-surface: var(--cxl-color--primary);
	--cxl-color-surface: var(--cxl-color--surface);
}
:host([variant=outlined]) {
	border: 1px solid var(--cxl-color-outline);
	background-color: transparent;
}
:host([variant=elevated]) {
	--cxl-color-on-surface: var(--cxl-color-primary);
}
`);function Et(e){return v(e,"disabled").switchMap(t=>t?A:Ut(e).tap(a=>{a.stopPropagation(),e.click()}))}function Ct(e){return d(Et(e),lt(e))}var ct=class extends g{disabled=!1;touched=!1};u(ct,{init:[x("disabled"),x("touched")],augment:[se("button"),Ct]});var At=class extends ct{size;color;variant};u(At,{tagName:"c-button",init:[he("size",e=>`{
			font-size: ${14+e*4}px;
			min-height: ${40+e*8}px;
			padding-right: ${16+e*4}px;
			padding-left: ${16+e*4}px;
		}`),Le("color","primary"),x("variant")],augment:[...Ue,Mr,we,N]});var Rr=m(`
:host {
	box-sizing: border-box;
	position: relative;
	display: flex;
	padding: 4px 16px;
	min-height: 56px;
	align-items: center;
	column-gap: 16px;
	${z("body-medium")}
}
:host([disabled]) { color: color-mix(in srgb, var(--cxl-color-on-surface) 38%, transparent); }
:host([selected]) {
	background-color: var(--cxl-color-secondary-container);
	color: var(--cxl-color-on-secondary-container);
}
`);function Tr(e){return d(kr("list",e),v(e,"selected").tap(t=>e.ariaSelected=String(t)))}function Lr(e){return d(Et(e),lt(e,e,-1),Tr(e))}var ut=class extends g{disabled=!1;touched=!1;selected=!1};u(ut,{init:[x("disabled"),x("touched"),x("selected")],augment:[Lr]});var Ir=class extends ut{size};u(Ir,{tagName:"c-item",init:[he("size",e=>`{min-height:${56+e*8}px}`)],augment:[Rr,Te,ot,se("option"),N,we]});var Br=[m(`
:host {
	--cxl-color-on-surface: var(--cxl-color-on-surface-variant);
	--cxl-color-ripple: var(--cxl-color-secondary-container);
	background-color: var(--cxl-color-surface);
	color: var(--cxl-color-on-surface);
	${z("label-large")}
	box-sizing: border-box;
	position: relative;
	cursor: pointer;
	border-radius: 28px;
	overflow:hidden;
	display: flex;
	padding: 4px 16px;
	min-height: 56px;
	align-items: center;
	column-gap: 16px;
	-webkit-tap-highlight-color: transparent;
	z-index: 0;
}
:host(:focus-visible) { z-index: 1; }
:host(:focus-visible) slot {
	outline: 3px auto var(--cxl-color-secondary);
}
:host([selected]) {
	--cxl-color-on-surface: var(--cxl-color-on-secondary-container);
	background-color: var(--cxl-color-secondary-container);
	font-weight: var(--cxl-font-weight-label-large-prominent);
}
/** Avoid accessibility errors with background */
:host([selected]) c-ripple { background-color: var(--cxl-color-surface); }
c-ripple { z-index: -1 }
:host([dense]) { min-height:48px; }
${kt("c-ripple")}
	`),Te,Cr,N],Dt=class extends ut{size};u(Dt,{tagName:"c-nav-item",init:[he("size",e=>`{min-height:${56+e*8}px}`)],augment:[se("option"),...Br]});var Or=class extends Dt{href;external=!1;target};u(Or,{tagName:"c-router-item",init:[f("href"),f("external"),f("target")],augment:[e=>St(e).tap(t=>{e.selected=t})]});function Pr(e){function t(){M=s[c],Y=Math.min(Math.round(R*T),j),q=(R-Math.floor(M/T))/(Y-M||1),(!isFinite(q)||q<=0)&&(q=.01),ae=!1}function a(X){throw console.error(`Faulty element detected: 
The provided element has an invalid or unmeasurable size. Check that the "${c}" of the element is not zero or negative. Make sure the element is styled properly and any necessary dimensions are set correctly before rendering.`),console.log(X),new Error("Rendered element size returned invalid value.")}function r(){ae&&t();let X=s[K],te=q*X;S=te|0;let ie=Math.max(Math.min(S,R-$+1),0),Be=S+$>R?1/0:M,Ve=te-S,re=ie,xe=0,We=0,le=0,p=0,b=0;for($=0,ie>0?le=-(o(re-1,xe++,"pre")[c]+Ve*T):le=-Ve*T;re>=0&&We<Be&&re<R;){let h=o(re++,xe++,"on"),k=h[c];k<=0&&a(h),$===0&&(p=h[D]),b=h[D]+k,We=b+le,$++}return re<R&&Be&&o(re,xe++,"post"),l?.(xe),$>0&&(T=(b-p)/$),$>1&&S+$>=R&&(le=M-b,le>0&&(le=0)),O&&(t(),O=!1),{start:ie,end:re,totalSize:Y,count:$,offset:le}}let{axis:n,scrollElement:s,render:o,refresh:i,remove:l}=e,c=n==="x"?"offsetWidth":"offsetHeight",D=n==="x"?"offsetLeft":"offsetTop",K=n==="x"?"scrollLeft":"scrollTop",j=5e6,R=e.dataLength,$=0,M=0,Y=0,q=0,T=50,S=0,O=!0,ae=!0,fe=y(s,"scroll",{passive:!0});return d(i?.tap(X=>{X?.dataLength!==void 0&&(R=X.dataLength),ae=!0})??A,De(s).switchMap(X=>X?d(Fe(s).raf(()=>ae=!0),fe):A)).raf().map(r)}function fa(e){let{axis:t,host:a,translate:r=!0}=e,n=e.scrollElement||a.parentElement;if(!n)throw"scrollElement option could not be resolved.";let s=document.createElement("div"),o=t==="x"?"width":"height";s.style.position="absolute",s.style.width=s.style.height="1px",s.style.top=s.style.left="0",(e.scrollContainer??n).appendChild(s),a.style.position="sticky",a.style.top=a.style.left="0",r&&(a.style.translate="0 0");let i=0,l=!1;return Pr({...e,scrollElement:n}).tap(({totalSize:c,offset:D})=>{if(r)if(D!==0){let K=D|0;a.style.translate=t==="x"?`${K}px 0`:`0 ${K}px`,l=!0}else l&&(a.style.translate="0 0",l=!1);i!==c&&(s.style[o]=`${c}px`,i=c)}).finalize(()=>s.remove())}var Hr=class extends g{font};u(Hr,{tagName:"c-t",init:[x("font")],augment:[m(`:host{display:inline-block;font:var(--cxl-font-body-medium);}${ia.map(e=>`:host([font="${e}"]){font:var(--cxl-font-${e});letter-spacing:var(--cxl-letter-spacing-${e})}`).join("")}
:host([font=h1]) { ${z("display-large")} display:block;margin-top: 64px; margin-bottom: 24px; }
:host([font=h2]) { ${z("display-medium")} display:block;margin-top: 56px; margin-bottom: 24px; }
:host([font=h3]) { ${z("display-small")} display:block; margin-top: 48px; margin-bottom: 16px; }
:host([font=h4]) { ${z("headline-medium")} display:block; margin-top: 40px; margin-bottom: 16px; }
:host([font=h5]) { ${z("title-large")} display:block;margin-top: 32px; margin-bottom: 12px; }
:host([font=h6]) { ${z("title-medium")} display:block;margin-top: 24px; margin-bottom: 8px; }
:host([font=h1]:first-child),:host([font=h2]:first-child),:host([font=h3]:first-child),:host([font=h4]:first-child),:host([font=h5]:first-child),:host([font=h6]:first-child){margin-top:0}
			`),N,e=>v(e,"font").tap(t=>{switch(t){case"h1":case"h2":case"h3":case"h4":case"h5":case"h6":e.role="heading",e.ariaLevel=t.slice(1);break;default:e.role=e.ariaLevel=null}})]});var Zn=class{currentPopupContainer;currentPopup;currentModal;currentTooltip;popupContainer=document.body;toggle(e){e.element.parentElement!==this.popupContainer?this.popupOpened(e):e.close()}popupOpened(e){this.currentPopup&&e.element!==this.currentPopup.element&&this.currentPopup.close(),this.currentPopup=e}openModal(e){this.currentModal&&e.element!==this.currentModal.element&&this.currentModal.close(),e.element.parentNode||this.popupContainer?.append(e.element),e.element.open||e.element.showModal(),this.currentModal=e}closeModal(){this.currentModal?.close(),this.modalClosed()}modalClosed(){this.currentModal=void 0}tooltipOpened(e){this.currentTooltip&&this.currentTooltip!==e&&this.currentTooltip.remove(),this.currentTooltip=e}close(){this.currentPopup?.close()}},ke=new Zn;function jr(e){let t=e.target;if(t)return typeof t=="string"?t.split(" ").flatMap(a=>{let r=wt(e,a);return r?[r]:[]}):Array.isArray(t)?t:[t]}function Jn(e,t,a,r,n=y(e,"click").map(()=>!a())){return d(r,n).switchMap(s=>{let o=t();return o?Pt(o.map(i=>({target:i,open:s}))):A})}function ma(e,t=e){function a(s,o){return[v(e,"open").switchMap(i=>(s.parentNode||ke.popupContainer.append(s),i&&s instanceof g?H(s,"open").map(l=>{e.open&&l===!1&&(e.open=!1)}):A)),pa(s).tap(i=>{let l=s.getAttribute("role");(l==="menu"||l==="listbox"||l==="tree"||l==="grid"||l==="dialog")&&(o.ariaHasPopup=l),o.getRootNode()===s.getRootNode()&&o.setAttribute("aria-controls",i)})]}let r=Z(v(e,"trigger"),v(e,"target")).switchMap(([s])=>{let o=jr(e),i=o?d(...o.flatMap(l=>a(l,e))).ignoreElements():A;return d(s==="hover"?Z(xt(t),o?d(...o.map(l=>xt(l))):A).map(l=>!!l.find(c=>!!c)).debounceTime(250):s==="checked"?y(t,"change").map(l=>l.target&&"checked"in l.target?!!l.target.checked:!1):y(t,"click").map(()=>!e.open),i)}),n;return Vt().switchMap(()=>Jn(t,()=>jr(e),()=>e.open,v(e,"open"),r).filter(s=>{let{open:o,target:i}=s;if(e.open!==o){if(o)n=Gt(e)?.activeElement,i.trigger=e;else if(i.trigger&&i.trigger!==e)return s.open=!0,i.trigger=e,!0;return e.open=o,!1}if(!o&&i.trigger===e){let l=document.activeElement;(l===document.body||l===document.documentElement)&&n?.focus()}return!0}))}var qr=class extends g{open=!1;target;trigger};u(qr,{init:[f("target"),f("trigger"),x("open")],augment:[e=>ma(e).raf(({target:t,open:a})=>t.open=a)]});var eo=class extends qr{};u(eo,{tagName:"c-toggle",augment:[nt,N]});var Ft=class extends g{name="";width;height;alt;fill=!1};u(Ft,{tagName:"c-icon",init:[f("name"),f("width"),f("height"),f("fill"),f("alt")],augment:[se("none"),m(`
		:host {
			display: inline-block;
			width: 24px;
			height: 24px;
			flex-shrink: 0;
			vertical-align: middle;
		}
		.icon { width: 100%; height: 100% }
		`),e=>{let t=new CSSStyleSheet,a;return e.shadowRoot?.adoptedStyleSheets.push(t),et(e).switchMap(()=>rt(e)).debounceTime(0).tap(()=>{let r=e.width??e.height,n=e.height??e.width;t.replace(`:host{${r===void 0?"":`width:${r}px;`}${n===void 0?"":`height:${n}px`}}`),a?.remove(),a=e.name?da(e.name,{className:"icon",width:r,height:n,fill:e.fill,alt:e.alt}):void 0,a&&(a.onerror=()=>{a&&e.alt&&a.replaceWith(e.alt)},U(e).append(a))})}]});var ha=class extends At{};u(ha,{tagName:"c-button-round",augment:[m(`
:host { min-width:40px; min-height: 40px; padding: 4px; border-radius: 100%; flex-shrink: 0; }
:host([variant=text]) { margin: -8px; }
:host([variant=text]:not([disabled])) { color: inherit; }
:host(:hover) { box-shadow:none; }
		`)]});var Ye=class extends ha{icon="";width;height;fill=!1;variant="text";alt};u(Ye,{tagName:"c-icon-button",init:[f("icon"),f("width"),f("height"),f("alt"),f("fill")],augment:[e=>C(Ft,{className:"icon",width:v(e,"width"),height:v(e,"height"),name:v(e,"icon"),fill:v(e,"fill"),alt:v(e,"alt")})]});var _r=class extends Ye{open=!1;target;icon="menu"};u(_r,{tagName:"c-navbar-toggle",init:[f("target"),Xt("open")],augment:[e=>ma(e).tap(({target:t,open:a})=>t.open=a)]});var $e;function Ur(e){if(e==="0s"||e==="auto")return;let t=e.endsWith("ms")?1:1e3;return parseFloat(e)*t}function to(e){return e==="infinite"?1/0:+e}function ao(e){if($r(e))return{animation:e};let t=e.startsWith("auto ");t&&(e="0s "+e.slice(5));let a={},r;e=e.replace(/stagger:(\d+)|composition:(\w+)/g,(i,l,c)=>(l&&(r=+l),c&&(a.composite=c),"")),$e??=document.createElement("style").style,$e.animation=e,a.fill=$e.animationFillMode;let n=a.fill==="forwards"||a.fill==="both",s=t?void 0:Ur($e.animationDuration);s!==void 0&&(a.duration=s);let o=Ur($e.animationDelay);return o!==void 0&&(a.delay=o),$e.animationIterationCount&&(a.iterations=to($e.animationIterationCount)),{animation:$e.animationName,keep:n,stagger:r,options:a}}function ro(e){return typeof e=="string"&&(e=e.split(",").map(t=>ao(t.trim()))),e}function ga(e,t,a,r){let n=r?`motion-${r}-on`:"motion-on",s=ro(a);return e.setAttribute(n,""),d(...s.map(o=>Sr({target:t,...o}))).finalize(()=>e.removeAttribute(n))}var Yr=m(":host(:not([open],[motion-out-on])){display:none}");function xa(e,t=()=>e,a=!1){let r=Q(()=>I(t("in"))),n=Q(()=>I(t("out")));return d(ze(e,"toggle.close").tap(()=>e.open=!1).ignoreElements(),Z(v(e,"motion-in").map(s=>s?r.switchMap(o=>ga(e,o,s,"in")).switchMap(()=>e.duration!==void 0&&e.duration!==1/0?be(e.duration).map(()=>e.open=!1):A):r),v(e,"motion-out").map(s=>(s?n.switchMap(o=>ga(e,o,s,"out").ignoreElements()):n).finalize(()=>{e.open||e.dispatchEvent(new Event("close"))}))).switchMap(([s,o])=>H(e,"open").switchMap(i=>{if(e.popover!=="auto"){let l=i?"open":"closed";e.dispatchEvent(new ToggleEvent("toggle",{oldState:i?"closed":"open",newState:l}))}return i?a?ce(o,s):s:a?ce(o,s):o})))}var Nt=class extends g{open=!1;duration;"motion-in";"motion-out"};u(Nt,{init:[f("motion-in"),f("motion-out"),Zt("duration"),x("open")]});var no=class extends Nt{};u(no,{tagName:"c-toggle-target",augment:[m(`
:host{display:contents}
`),e=>{let t=C("slot"),a=C("slot",{name:"off"});return(e.open?a:t).style.display="none",U(e).append(t,a),xa(e,r=>{t.style.display=a.style.display="none";let n=e.open?r==="in"?t:a:r==="in"?a:t;return n.style.display="",n.assignedElements()},!0)}]});var ba=class extends Nt{};u(ba,{tagName:"c-toggle-panel",augment:[N,Yr,xa]});var va=class extends g{center=!1};u(va,{tagName:"c-backdrop",init:[x("center")],augment:[m(`
:host {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  background-color: var(--cxl-color-scrim);
  overflow: hidden;
}
:host([center]) {
  display: flex;
  justify-content: center;
  align-items: center;
}

	`),e=>y(e,"keydown").tap(t=>t.stopPropagation()),N]});var Vr=m(`
#drawer {
	box-sizing: border-box;
    background-color: var(--cxl-color-surface);
    color: var(--cxl-color-on-surface);
    position: absolute;
	display: block;
    width: 85%;
	min-width: 256px;

    overflow-y: auto;
    overflow-x: hidden;
    z-index: 5;
}
${de("small","#drawer { width: 360px }")}

#dialog {
    margin: 0;
    padding: 0;
    border-width: 0;
    max-width: none;
    max-height: none;
    width: 100%;
    height: 100%;
    background-color: transparent;
    overflow-x: hidden;
    overflow-y: hidden;
    text-align: initial;
}

#dialog::backdrop {
    background-color: transparent;
}
`),Wr=class extends g{open=!1;position;responsive;permanent=!1};u(Wr,{tagName:"c-drawer",init:[x("open"),x("position"),f("responsive"),f("permanent")],augment:[Vr,m(`
:host { max-width: 360px; }
#drawer.permanent {
	${pe("surface")}
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
    width: 100%;
    height: 100%;
	z-index: 0;
}
#drawer {
    top: 0;
    bottom: 0;
}
#drawer, :host([position=left]) #drawer {
	left: 0;
	border-radius: 0 var(--cxl-shape-corner-large) var(--cxl-shape-corner-large) 0;
}
:host([position=right]) #drawer,:host(:not([position]):dir(rtl)) #drawer {
	right: 0;
	left: auto;
	border-radius: var(--cxl-shape-corner-large) 0 0 var(--cxl-shape-corner-large);
}
:host([responsiveon]) #backdrop { display: none; }
:host([responsiveon]) #dialog { display: contents; }
`),e=>{let t=ve(!1),a=d(v(e,"position"),t).raf(),r=()=>e.position==="right"||getComputedStyle(e).direction==="rtl",n=C(ba,{id:"drawer","motion-in":a.map(()=>e.permanent&&t.value?void 0:r()?"slideInRight":"slideInLeft"),"motion-out":a.map(()=>e.permanent&&t.value?void 0:r()?"slideOutRight":"slideOutLeft")},N),s=new va;s.id="backdrop";let o=C("dialog",{id:"dialog"},s,n);return U(e).append(o),d(y(n,"close").tap(()=>o.close()),y(o,"close").tap(()=>e.open=!1),H(n,"open").tap(i=>e.open=i),H(e,"open").raf(i=>{i||n.scrollTo(0,0)}),y(s,"click").tap(()=>e.open=!1),y(o,"cancel").tap(i=>{i.preventDefault(),e.open=!1}),v(e,"open").tap(i=>{if(t.value&&e.permanent)return n.open=!0;i?t.value||(ke.openModal({element:o,close:()=>e.open=!1}),o.getBoundingClientRect()):ke.currentModal?.element===o&&ke.modalClosed()}).raf(i=>{n.open=i}),v(e,"responsive").switchMap(i=>i!==void 0?st(document.body):I("xsmall")).switchMap(i=>{let l=B.breakpoints[e.responsive||"large"],c=B.breakpoints[i]>=l;return t.next(c),c&&n.className!=="permanent"?o.close():!c&&n.className==="permanent"&&(e.open=!1),c&&e.open===!1&&(e.open=e.permanent),e.toggleAttribute("responsiveon",c),n.className=c?"permanent":"drawer",H(e,"open").tap(D=>{e.hasAttribute("responsiveon")||ge({target:s,animation:D?"fadeIn":"fadeOut",options:{fill:"forwards"}})})}))}]});var so=()=>{let e;function t(){let a=document.adoptedStyleSheets.indexOf(e);a!==-1&&document.adoptedStyleSheets.splice(a,1)}addEventListener("message",a=>{let{theme:r}=a.data;t(),r!==void 0&&(e=new CSSStyleSheet,e.replace(r),document.adoptedStyleSheets.push(e))})},io=()=>{addEventListener("load",()=>{let e=()=>{parent.postMessage({height:document.documentElement.scrollHeight},"*")};requestAnimationFrame(async()=>{await document.fonts.ready,new ResizeObserver(e).observe(document.documentElement)})})},Gr=class extends g{src="";srcdoc="";sandbox="allow-forms allow-scripts";reset="<!DOCTYPE html><style>html{display:flex;flex-direction:column;font:var(--cxl-font-default);}body{padding:0;margin:0;translate:0;overflow:auto;}</style>";handletheme=!0};u(Gr,{tagName:"c-iframe",init:[f("src"),f("srcdoc"),f("sandbox"),f("handletheme")],augment:[m(`
:host {
  position: relative;
  display: flex;
  flex-direction: column;
  background-color: transparent;
}
iframe {
  width: 100%;
  height: 0;
  opacity: 0;
  transition: opacity var(--cxl-speed);
  display: flex;
  border-style: none;
}
	`),e=>{let t=je("iframe",{loading:"lazy"}),a=je("slot",{name:"loading"}),r=new CSSStyleSheet;e.shadowRoot?.adoptedStyleSheets.push(r),a.style.display="none";function n(o){r.replaceSync(":host{height:"+o+"px}"),t.style.height="100%",t.style.opacity="1",a.style.display="none"}function s(o){if(o){let i=`<script type="module">
(${io.toString()})();
(${so.toString()})();
<\/script>`;t.srcdoc=`${e.reset}${o}${i}`,a.style.display=""}else t.srcdoc=""}return U(e).append(t,a),d(Z(v(e,"srcdoc"),v(e,"src")).tap(async([o,i])=>{s(i?`<base href="${i}" />`+await fetch(i).then(l=>l.text()):o)}),y(window,"message").tap(o=>{let{height:i}=o.data;o.source===t.contentWindow&&i!==void 0&&n(i)}),v(e,"handletheme").switchMap(o=>o?y(t,"load").switchMap(()=>_e.raf(i=>{let l=i?.css??"";t.contentWindow?.postMessage({theme:l},"*")})):A),v(e,"sandbox").tap(o=>o===void 0?t.removeAttribute("sandbox"):t.sandbox.value=o))}]});var Kr=class extends ct{};u(Kr,{tagName:"c-button-text",augment:[...Ue,m(`
:host {
	${z("label-large")}
	padding: 0 12px; border-radius: var(--cxl-shape-corner-full);
	flex-shrink: 0;
	margin: -10px -12px;
	background-color: transparent;
	color: var(--cxl-color-primary);
	cursor: pointer;
	overflow: hidden;
	display: inline-flex;
	justify-content: center;
	align-items: center;
	column-gap: 8px;
	line-height: unset;
	min-height: 40px;
	align-self: center;
}
:host([disabled]) {
	color: color-mix(in srgb, var(--cxl-color--on-surface) 38%, transparent);
	background-color: transparent;
}
:host(:hover) { box-shadow: none; }
		`),we,N]});function Xr(e="block"){let t=(a=>{for(let r=12;r>0;r--)a.xl+=`:host([xl="${r}"]){display:${e};grid-column-end:span ${r};}`,a.lg+=`:host([lg="${r}"]){display:${e};grid-column-end:span ${r};}`,a.md+=`:host([md="${r}"]){display:${e};grid-column-end:span ${r};}`,a.sm+=`:host([sm="${r}"]){display:${e};grid-column-end:span ${r};}`,a.xs+=`:host([xs="${r}"]){display:${e};grid-column-end:span ${r};}`;return a})({xl:"",lg:"",md:"",sm:"",xs:""});return m(`
:host { box-sizing:border-box; display:${e}; }
${t.xs}
:host([xs="0"]) { display:none }
:host([xsmall]) { display:${e} }
${de("small",`
:host { grid-column-end: auto; }
:host([small]) { display:${e} }
${t.sm}
:host([sm="0"]) { display:none }
`)}
${de("medium",`
${t.md}
:host([md="0"]) { display:none }
:host([medium]) { display:${e} }
`)}
${de("large",`
${t.lg}
:host([lg="0"]) { display:none }
:host([large]) { display:${e} }
`)}
${de("xlarge",`
${t.xl}
:host([xl="0"]) { display:none }
:host([xlarge]) { display:${e} }
`)}
`)}var Qr=m(`
:host([grow]) { flex-grow:1; flex-shrink: 1 }
:host([color]) { background-color: var(--cxl-color-surface); color: var(--cxl-color-on-surface); }
:host([fill]) { position: absolute; inset:0 }
:host([elevation]) { --cxl-color-on-surface: var(--cxl-color--on-surface); }
:host([elevation="0"]) { --cxl-color-surface: var(--cxl-color-surface-container-lowest); }
:host([elevation="1"]) { --cxl-color-surface: var(--cxl-color-surface-container-low); }
:host([elevation="2"]) { --cxl-color-surface: var(--cxl-color-surface-container); }
:host([elevation="3"]) { --cxl-color-surface: var(--cxl-color-surface-container-high); }
:host([elevation="4"]) { --cxl-color-surface: var(--cxl-color-surface-container-highest); }
${Ie()}
${$t.map(e=>`:host([pad="${e}"]){padding:${e}px}`).join("")}
${$t.map(e=>`:host([vpad="${e}"]){padding-top:${e}px;padding-bottom:${e}px}`).join("")}`),ya=class extends g{grow=!1;fill=!1;xs;sm;md;lg;xl;pad;vpad;color;center=!1;elevation};u(ya,{init:[x("sm"),x("xs"),x("md"),x("lg"),x("xl"),x("vpad"),x("pad"),x("center"),x("fill"),x("grow"),x("elevation"),Le("color")]});var zt=class extends ya{};u(zt,{tagName:"c-c",augment:[Qr,Xr(),m(":host([center]) { text-align: center}"),N]});var Zr=m(`
:host {
	${pe("surface-container")}
	${z("body-medium")}
	border-radius: var(--cxl-shape-corner-medium);
	overflow: hidden;
}
:host([variant=elevated]:not([color])) {
	--cxl-color-surface: var(--cxl-color-surface-container-low);
	z-index: 1;
	box-shadow: var(--cxl-elevation-1);
}
:host([variant=outlined]) {
	${pe("surface")}
	border: 1px solid var(--cxl-color-outline-variant);
}
${Ie()}
`),Jr=class extends zt{variant};u(Jr,{tagName:"c-card",init:[x("variant")],augment:[Zr]});var en=class extends g{disabled=!1;touched=!1;selected=!1;color;size=0};u(en,{tagName:"c-chip",init:[x("disabled"),x("touched"),x("selected"),Le("color","surface-container-low"),he("size",e=>`{
			padding: 2px ${e<0?2:8}px;
			font-size: ${14+e*2}px;
			height: ${32+e*6}px;
		}`)],augment:[se("button"),Ct,...Ue,m(`
:host {
	box-sizing: border-box;
	border: 1px solid var(--cxl-color-outline-variant);
	border-radius: var(--cxl-shape-corner-small);
	${z("label-large")}
	display: inline-flex;
	align-items: center;
 	position: relative;
	overflow: hidden;
 	column-gap: 8px;
	flex-shrink: 0;
	cursor: pointer;
	flex-wrap: nowrap;
	align-self: center;
}
:host([disabled]) {
	background-color: color-mix(in srgb, var(--cxl-color--on-surface) 12%, transparent);
	color: color-mix(in srgb, var(--cxl-color--on-surface) 38%, transparent);
	border-color: color-mix(in srgb, var(--cxl-color-on-surface) 12%, transparent);
}
:host([selected]) {
	border-color: var(--cxl-color-secondary-container);
	${pe("secondary-container")}
}
:host(:hover) { box-shadow: none; }
slot[name] { display: inline-block; }
		`),we,()=>C("slot",{name:"leading"}),N,()=>C("slot",{name:"trailing"})]});var Ql=1440*60*1e3;function tn(e,t,a){if(t==="relative"){let r=new Date;return e.getFullYear()===r.getFullYear()?e.getDate()===r.getDate()&&e.getMonth()===r.getMonth()?e.toLocaleTimeString(a,{hour:"2-digit",minute:"2-digit",hourCycle:"h24"}):e.toLocaleDateString(a,{month:"2-digit",day:"2-digit"}):e.toLocaleDateString(a,{month:"2-digit",day:"2-digit",year:"2-digit"})}return t==="medium"||t==="long"||t==="short"||t==="full"?e.toLocaleString(a,{dateStyle:t,timeStyle:t}):e.toLocaleString()}function an(e,t,a){return t?typeof a=="string"?tn(t,a,e):t.toLocaleString(e,a):""}var rn={"core.enable":"Enable","core.disable":"Disable","core.cancel":"Cancel","core.ok":"Ok","core.open":"Open","core.close":"Close","core.of":"of"};function lo(){try{return new Intl.NumberFormat(navigator.language),navigator.language}catch{return"en-US"}}var Mt={content:rn,name:"default",localeName:lo(),currencyCode:"USD",decimalSeparator:1.1.toLocaleString().substring(1,2),weekStart:0,formatDate:(e,t)=>an(Mt.localeName,e,t)},co={content:rn,name:"en",localeName:"en-US",currencyCode:"USD",decimalSeparator:".",weekStart:0,formatDate:(e,t)=>an("en-US",e,t)};function uo(){let e=ve(Mt),t={default:Mt,en:co},a={},r=e.map(o=>o.content);async function n(o){let i=o.split("-")[0];if(!(t[o]??t[i])){let l=a[o]??a[i];l&&await l()}return t[i]||Mt}async function s(o){e.next(await n(o))}return navigator?.language&&s(navigator.language),{content:r,registeredLocales:t,locale:e,setLocale:s,getLocale(o){return o?Ke(()=>n(o)):e},get(o,i){return r.map(l=>l[o]??(i&&l[i])??"")},register(o){t[o.name]=o}}}var nn=uo();var Rt=[m(`
:host {
	box-sizing: border-box;
	background-color: var(--cxl-color-surface);
	color: var(--cxl-color-on-surface);
	flex-shrink: 0;
	display: flex;
	align-items: center;
	column-gap: 24px;
	min-height: 64px;
	padding: 4px 16px;
	${z("title-large")}
}
:host([size=medium]) {
	height: 112px;
	padding: 20px 16px 24px 16px;
	${z("headline-small")}
	flex-wrap: wrap;
}
:host([size=medium]) slot[name=title],:host([size=large]) slot[name=title]  { width: 100%; display: block; margin-top:auto; }
:host([size=large]) {
	height: 152px; padding: 20px 16px 28px 16px;
	${z("headline-medium")}
	flex-wrap: wrap;
}`),N,()=>C("slot",{name:"title"})];function po(e){return e.tagName==="C-APPBAR-CONTEXTUAL"}var on=class extends g{size;sticky=!1;contextual};u(on,{tagName:"c-appbar",init:[x("size"),x("sticky"),x("contextual")],augment:[m(`
:host {
	z-index: 2;
	width:100%;
}
:host([sticky]) { position: sticky; top: -1px; }
:host([scroll]) {
 	transition: background-color var(--cxl-speed);
	border-top: 1px solid var(--cxl-color-surface-container); background-color: var(--cxl-color-surface-container)
}
:host([contextual]) { padding: 0; }
:host([contextual]) slot:not([name=contextual]) { display:none; }
		`),...Rt,()=>C("slot",{name:"contextual"}),e=>v(e,"sticky").switchMap(t=>t?Je(e,{threshold:[1]}).tap(a=>e.toggleAttribute("scroll",a.intersectionRatio<1)):A),e=>{let t;return d(Ze(e),v(e,"contextual")).raf().switchMap(()=>{for(let a of e.children)if(po(a)&&(a.slot="contextual",a.open=a.name===e.contextual,a.open))return t=a,y(a,"close").tap(()=>e.contextual=void 0);return t&&(t.open=!1),t=void 0,A})}]});var sn=class extends g{name;size;open=!1;backIcon=C(Ye,{icon:"arrow_back",className:"icon",ariaLabel:nn.get("core.close"),$:e=>me(e).tap(()=>this.open=!1)})};u(sn,{tagName:"c-appbar-contextual",init:[f("name"),x("open"),x("size")],augment:[e=>e.backIcon,...Rt,m(`		
:host {
	display: none;
	flex-grow: 1;
	overflow-x: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}
:host([open]) { display: flex }
:host(:dir(rtl)) .icon { scale: -1 1; }
`),e=>H(e,"open").tap(t=>{t||e.dispatchEvent(new Event("close"))})]});function ln(e=document){document.documentElement.lang="en";let t=[C("meta",{name:"viewport",content:"width=device-width, initial-scale=1"}),C("meta",{name:"apple-mobile-web-app-capable",content:"yes"}),C("meta",{name:"mobile-web-app-capable",content:"yes"}),C("style",void 0,`html{height:100%;}html,body{padding:0;margin:0;min-height:100%;${z("body-large")}}
			a{color:var(--cxl-color-on-surface)}
			`)];return e.head.append(...t),t}function cn(e=2e3){return d(be(e),it()).first()}function un(e){return cn().raf(()=>e.setAttribute("ready",""))}function dn(e){return d(J(t=>{let a=ln(e.ownerDocument??document);t.signal.subscribe(()=>a.forEach(r=>r.remove()))}),Oe().raf(()=>{let t=e.firstElementChild;t instanceof HTMLTemplateElement&&(e.append(t.content),t.remove())}),cn().switchMap(()=>st(e).raf(t=>e.setAttribute("breakpoint",t))),un(e),la.raf(t=>t?e.setAttribute("theme",t):e.removeAttribute("theme")))}var fo=class extends g{connectedCallback(){requestAnimationFrame(()=>ln(this.ownerDocument||document)),super.connectedCallback()}};u(fo,{tagName:"c-meta",augment:[()=>un(document.body)]});function pn(e,t,a){a==="in"&&(e.style.display="");let r=e.offsetWidth,n=ge({target:e,animation:{kf:{[t]:a==="in"?[`-${r}px`,"0"]:["0",`-${r}px`]}}});a==="out"&&(n.onfinish=()=>e.style.display="none")}var fn=class extends g{sheetstart=!1;sheetend=!1};u(fn,{tagName:"c-application",init:[x("sheetstart"),x("sheetend")],augment:[m(`
:host {
	display: flex;
	position: absolute;
	inset: 0;
	${pe("background")}
	overflow: hidden;
}
#body {
	display: flex;
	flex-direction: column;
	flex-grow: 1;
	overflow: hidden;
}
slot[name=end],slot[name=start] { display:block; flex-shrink: 0; }
${Ie()}
	`),dn,e=>ze(e,"toggle.open").tap(t=>{(t==="sheetend"||t==="sheetstart")&&(e[t]=!0)}),e=>ze(e,"toggle.close").tap(t=>{(t==="sheetend"||t==="sheetstart")&&(e[t]=!1)}),e=>{let t=C("slot",{name:"start"}),a=C("slot",{id:"body"}),r=C("slot",{name:"end"}),n=Re("html { overflow: hidden }");return U(e).append(t,a,r),e.sheetstart||(t.style.display="none"),e.sheetend||(r.style.display="none"),ke.popupContainer=e,d(J(s=>{let o=(e.ownerDocument??document).adoptedStyleSheets;o.push(n),s.signal.subscribe(()=>{let i=o.indexOf(n);i!==-1&&o.splice(i,1)})}),H(e,"sheetstart").tap(s=>pn(t,"marginLeft",s?"in":"out")),H(e,"sheetend").tap(s=>pn(r,"marginRight",s?"in":"out")))}]});var mn=class extends g{};u(mn,{tagName:"c-body",augment:[m(`
:host {
	position: relative;
	display: flex;
	flex-direction: column;
	flex-grow: 1;
	overflow-x:hidden;
	overflow-y: auto;
	-webkit-overflow-scrolling: touch;
	background-color: var(--cxl-color-background);
	color: var(--cxl-color-on-background);
}
slot { display: flex; flex-direction: column; max-width: 1200px; flex-grow: 1; }

${de("medium",`
	:host{padding:32px;}
	slot { margin: 0 auto; width:100%; }
`)}

		`),N]});var dt=class{capacity;map=new Map;constructor(t=1e3){this.capacity=t}get(t){return this.map.get(t)}set(t,a){let r=this.map;if(!r.has(t)&&r.size>=this.capacity){let n=r.keys().next().value;n!==void 0&&r.delete(n)}return r.set(t,a),a}[Symbol.iterator](){return this.map.values()}find(t){for(let a of this.map.values())if(t(a))return a}clear(){this.map.clear()}};function wa(){let e=document.createElement("canvas"),t=e.getContext("2d");if(!t)throw new Error("Could not acquire context");return{canvas:e,context:t}}function hn(e){function t(p,b,h,k,L,F){let P=p.toString(),w=S.measureText(P),_=(h-(w.actualBoundingBoxAscent+w.actualBoundingBoxDescent))/2+w.actualBoundingBoxAscent;return{text:P,baseline:_,y:b,height:h,chars:k,hasTabs:L,endIndex:p.endOffset-1,startIndex:p.startOffset,lineIndex:F}}function a(p,b){let h=O.length;if(h===0)return;let k=document.createRange();k.setStart(O,0),k.setEnd(O,h);let L=k.getClientRects(),F=0;b+=L[0]?.y??0;for(let W of L){if(b>=W.top&&b<=W.bottom)break;F++}let P=0,w=h-1,V=0,_=L[F];if(_){for(;P<=w;){let W=P+w>>1;k.setStart(O,W),k.setEnd(O,W+1);let ne=k.getBoundingClientRect();if(ne.bottom<_.top)P=W+1;else if(ne.top>_.bottom)w=W-1;else if(p<ne.left)w=W-1;else if(p>ne.right)P=W+1;else{V=W;break}}return P<=h-1&&(V=P),[V,F]}}function r(p,b){for(let h of p.lines)if(h.y<=b&&h.y+h.height>b)return[h.startIndex,h.lineIndex];return a(0,b)}function n(p){return fe.setStart(O,p),fe.setEnd(O,p+1),fe.getBoundingClientRect()}function s(p,b,h){let k=-1,L=-1,F=0,P=!1,w,V=p,_=[];X.setStart(O,p);do{if(w=n(V),w.height>F&&(F=w.height),k===-1&&(k=w.y-le.y,L=w.y+F),w.y>L)break;fe.toString()==="	"&&(P=!0),_.push({y:k,x:w.x-We.x,width:w.width,height:w.height,line:h})}while(V++<b);return X.setEnd(O,V),t(X,k,F,_,P,h)}function o(p,b){let{text:h,lines:k}=p;O.textContent=h||" ";let L=e.offsetHeight+b,F=b?r(p,b):[0,0];if(!F)return;let P=F[0],w=F[1],V=h.length-1,_=[];for(let W=P;W<V;W++){let ne=k.get(w);if(ne){if(ne.y+ne.height>b&&_.push(ne),W=ne.endIndex,ne.y>L)break;w++;continue}let Tt=s(W,V,w);if(_.push(k.set(w,Tt)),Tt.y>L)break;W=Tt.endIndex}return _}function i(p,b){let h=te.get(b);if(h)return h;let k=new dt;return O.textContent=p||" ",te.set(b,{lines:k,height:ae.offsetHeight,width:ae.offsetWidth,text:p})}function l(p,b){let h=i(b,p),k=Be;return ie.push(h),Be+=h.height,{offsetLeft:0,offsetWidth:h.width,offsetHeight:h.height,offsetTop:k}}function c(p){Be=0,Ve=p,ie.length=0}function D(){let p=window.devicePixelRatio||1,b=e.clientWidth*p,h=e.clientHeight*p;b!==S.canvas.width||h!==S.canvas.height?(S.canvas.width=b,S.canvas.height=h,S.scale(p,p),$()):S.clearRect(0,0,T.width,T.height),We=e.getBoundingClientRect(),le=ae.getBoundingClientRect(),re=!1}function K(p,b){if(p.hasTabs)for(let[h,k]of p.chars.entries())S.fillText(p.text.charAt(h),k.x,b+k.y+p.baseline);else S.fillText(p.text,0,b+p.y+p.baseline)}function j(p){let b=xe=p;re?D():S.clearRect(0,0,T.width,T.height);let h=S.canvas.height;for(let k of ie){let L=o(k,-p);if(p=0,L)for(let F of L)K(F,b);if(b+=k.height,b>h)break}}function R(){re=!0,te.clear()}function $(){let p=getComputedStyle(e);S.font=p.font,S.fillStyle=p.color,S.textBaseline="alphabetic"}function M(p){let b=0,h,k=0,L=e.offsetHeight-xe;for(let w=Ve;;w++){let V=te.get(w);if(!V)break;let _=V.height;if(p>=b&&p<b+_){h=V,k=b;break}if(b+=_,b>L)break}if(!h)return;let F=p-k|0;return{lineData:h.lines.find(w=>F>=w.y&&F<=w.y+w.height),accumulatedHeight:b}}function Y(p,b){let h=M(b);if(!h?.lineData)return;let{lineData:k,accumulatedHeight:L}=h,F=k.chars.find(P=>p<P.x+P.width);return F&&{char:F,lineData:k,y:L+F.y}}function q(p,b){let h=p,k=b-xe,L=M(k);if(!L?.lineData)return;let{lineData:F,accumulatedHeight:P}=L,w=F.chars.find(_=>h<_.x+_.width)??F.chars[F.chars.length-1];if(!w)return;let V=h<w.x+w.width/2;return{char:w,x:V?w.x:w.x+w.width,y:w.y+P}}let{canvas:T,context:S}=wa(),O=new Text,ae=C("div",{id:"measure"},O),fe=document.createRange(),X=document.createRange(),te=new dt,ie=[],Be=0,Ve=0,re=!0,xe=0,We,le;return{begin:c,canvas:S.canvas,commit:j,measureElement:ae,resize:R,updateStyles:$,renderLine:l,lineCache:te,getCharacterAtPosition:Y,getCaretAtPosition:q}}function gn(e){function t({char:M,x:Y,y:q},T){i(),$={x:Y|0,y:(q|0)+T,width:(D.type==="block"?M.width:K)|0,height:M.height|0,line:M.line},o()}function a(M){i(),$.y+=M,o()}function r(M=e.clientWidth,Y=e.clientHeight){let q=window.devicePixelRatio||1,T=M*q,S=Y*q;(T!==c.canvas.width||S!==c.canvas.height)&&(c.canvas.width=T,c.canvas.height=S,c.scale(q,q))}function n(M){let Y=D.interval;Object.assign(D,M),M.interval&&M.interval!==Y&&R&&o()}function s(){j=!j,c.clearRect($.x,$.y,$.width,$.height),j&&c.fillRect($.x,$.y,$.width,$.height)}function o(){i(),j=!0,c.fillRect($.x,$.y,$.width,$.height),R=window.setInterval(s,D.interval)}function i(){R&&clearInterval(R),R=void 0,c.clearRect($.x,$.y,$.width,$.height)}let{canvas:l,context:c}=wa(),D={type:"text",interval:500},K=window.devicePixelRatio>=2?2:1,j=!1,R,$={x:0,y:0,width:0,height:0,line:0};return{canvas:l,resize:r,setPosition:t,setOptions:n,scroll:a,clear:i,get line(){return $.line}}}function mo(){function e(){let l=[];for(let c of n){let D=c.source==="original"?i:s,K=0,j=D.indexOf(`
`,c.start-1);for(;j>=0&&j<c.start+c.length-1;)K++,j=D.indexOf(`
`,j+1);l.push(c.length>0?K+1:0)}o=[0];for(let c of l)o.push(o[o.length-1]+c)}function t(){return o[o.length-1]}function a(l){let c=o[o.length-1];if(l<0||l>=c)return"";let D=0,K=n.length-1;for(;D<K;){let S=D+K>>1;o[S+1]>l?K=S:D=S+1}let j=n[D],R=j.source==="original"?i:s,$=j.start+j.length,M=l-o[D],Y=j.start;for(let S=0;S<M;S++)Y=R.indexOf(`
`,Y)+1;let q=R.indexOf(`
`,Y),T="";if(q>=0&&q<$)T=R.slice(Y,q);else{T=R.slice(Y,$);let S=D+1;for(;S<n.length;){let O=n[S],ae=O.source==="original"?i:s,fe=O.start,X=fe+O.length,te=ae.slice(fe,X),ie=te.indexOf(`
`);if(ie>=0){T+=te.slice(0,ie);break}else T+=te,S++}}return T}function r(l){i=l,n=[{source:"original",start:0,length:i.length}],s="",e()}let n,s="",o=[],i="";return{getLine:a,getLineCount:t,reset:r}}var ka=class extends g{value=""};u(ka,{tagName:"c-source",init:[f("value")],augment:[m(`
:host {
	display: block;
	font-family: var(--cxl-font-monospace, monospace);
	cursor: text;
	outline: none;
	overflow:auto;
	box-sizing: border-box;
	position: relative;
	user-select: none;
	-webkit-user-select: none;
}
canvas {
	position: absolute; top: 0; left: 0;
	pointer-events: none;
	width:100%;
	height:100%;
}
#body { height:100%; }
#measure {
	visibility:hidden;
	position: absolute;
	top: 0; left: 0;
	white-space: pre-wrap;
	word-break: break-word;
}
#cursor {
	position: absolute;
	display: none;
	width: 2px;
	margin-left: -1px;
	background: currentColor;
	animation: blink 1.2s step-end infinite;
	pointer-events: none;
}
#test { white-space:pre-wrap; position:absolute; inset:0;overflow:auto;}
`),e=>{let t=C("div",{id:"body"}),a=hn(t),r=gn(t),n=jt(),s=mo(),o=0;return t.append(a.canvas,r.canvas,a.measureElement),e.shadowRoot?.append(t),d(it().switchMap(()=>De(e).switchMap(i=>i?d(d(Fe(t)).raf(()=>{t.clientHeight>0&&t.clientWidth>0&&(a.resize(),r.resize())}),fa({host:t,scrollElement:e,scrollContainer:e.shadowRoot??void 0,refresh:n,render(l,c){return c===0&&a.begin(l),a.renderLine(l,s.getLine(l))},dataLength:s.getLineCount(),translate:!1}).tap(l=>{(r.line<l.start||r.line>l.end)&&r.clear(),o=l.offset,a.commit(l.offset)})):A)),v(e,"value").tap(i=>{s.reset(i),n.next({dataLength:s.getLineCount()})}),y(t,"mousedown").tap(i=>{let l=a.getCaretAtPosition(i.offsetX,i.offsetY);l&&r.setPosition(l,o)}),_e.tap(()=>{a.updateStyles(),n.next()}))}]});export{ka as Source};
