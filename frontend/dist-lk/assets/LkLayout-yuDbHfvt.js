import{j as e}from"./chart-vendor-CkoAX-yw.js";import{u as h,f as u}from"./react-vendor-CgeT7Z0k.js";import{b5 as t,bs as x,bp as m,ac as p}from"./index-Dtz2aasb.js";import{U as b}from"./users-Be6rwHFY.js";/**
 * @license lucide-react v0.563.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g=[["rect",{width:"20",height:"14",x:"2",y:"5",rx:"2",key:"ynyp8z"}],["line",{x1:"2",x2:"22",y1:"10",y2:"10",key:"1b3vmo"}]],v=t("credit-card",g);/**
 * @license lucide-react v0.563.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=[["path",{d:"M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",key:"1xhozi"}]],y=t("headphones",f);/**
 * @license lucide-react v0.563.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const w=[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"14",y:"3",rx:"1",key:"6d4xhi"}],["rect",{width:"7",height:"7",x:"14",y:"14",rx:"1",key:"nxv5o0"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}]],N=t("layout-grid",w);/**
 * @license lucide-react v0.563.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k=[["path",{d:"m16 17 5-5-5-5",key:"1bji2h"}],["path",{d:"M21 12H9",key:"dn1m92"}],["path",{d:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",key:"1uf3rs"}]],j=t("log-out",k);/**
 * @license lucide-react v0.563.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _=[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]],z=t("user",_);function L(){return e.jsxs("div",{className:"fixed inset-0 pointer-events-none overflow-hidden z-0",children:[e.jsx("div",{className:"absolute inset-0",style:{backgroundImage:"radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)",backgroundSize:"20px 20px"}}),e.jsx("div",{className:"absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(0,0,0,0.85)_0%,_transparent_70%)]"}),e.jsx("div",{className:"absolute top-0 left-0 right-0 h-1/3 bg-gradient-to-b from-black to-transparent"}),e.jsx("div",{className:"absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-black to-transparent"})]})}const I=[{name:"Подписка",url:"/me",icon:v},{name:"Тарифы",url:"/tariffs",icon:N},{name:"Профиль",url:"/profile",icon:z}];function C({children:r}){const i=h(),{hasPartner:n,hasSupport:o}=x(),l=[...I,...n?[{name:"Пригласить",url:"/partner",icon:b}]:[],...o?[{name:"Поддержка",url:"/support",icon:y}]:[]],d=async()=>{await fetch("/api/lk/auth/logout",{method:"POST",credentials:"include"}),i("/",{replace:!0})};return e.jsxs("div",{className:"min-h-screen bg-black text-white",children:[e.jsx(L,{}),e.jsx("div",{className:"fixed top-0 left-1/2 -translate-x-1/2 z-50 pt-4",children:e.jsxs("div",{className:"flex items-center gap-1 bg-white/5 border border-white/10 backdrop-blur-lg py-1 px-1 rounded-full shadow-lg",children:[l.map(a=>{const c=a.icon;return e.jsx(u,{to:a.url,className:({isActive:s})=>p("relative cursor-pointer text-sm font-semibold px-5 py-2 rounded-full transition-colors duration-200","text-white/50 hover:text-white",s&&"text-white"),children:({isActive:s})=>e.jsxs(e.Fragment,{children:[e.jsx("span",{className:"relative z-10 hidden md:inline",children:a.name}),e.jsx("span",{className:"relative z-10 md:hidden",children:e.jsx(c,{size:18,strokeWidth:2.5})}),s&&e.jsx(m.div,{layoutId:"nav-lamp",className:"absolute inset-0 w-full bg-white/5 rounded-full -z-10",initial:!1,transition:{type:"spring",stiffness:300,damping:30},children:e.jsxs("div",{className:"absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-white rounded-t-full",children:[e.jsx("div",{className:"absolute w-12 h-6 bg-white/20 rounded-full blur-md -top-2 -left-2"}),e.jsx("div",{className:"absolute w-8 h-6 bg-white/20 rounded-full blur-md -top-1"}),e.jsx("div",{className:"absolute w-4 h-4 bg-white/20 rounded-full blur-sm top-0 left-2"})]})})]})},a.name)}),e.jsx("button",{onClick:d,className:"ml-1 text-white/30 hover:text-white/70 transition-colors p-2 rounded-full hover:bg-white/5",title:"Выйти",children:e.jsx(j,{size:16})})]})}),e.jsx("div",{className:"relative z-10 pt-24 pb-12 px-4 max-w-2xl mx-auto",children:r})]})}export{C as L,z as U};
