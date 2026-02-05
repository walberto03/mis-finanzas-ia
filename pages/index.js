import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, collection, onSnapshot, 
  query, orderBy, deleteDoc, doc, limit 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend
} from 'recharts';
import { 
  PieChart as PieIcon, MessageSquare, 
  Tag, TrendingUp, TrendingDown, Filter, X, Wallet, 
  Zap, CloudLightning, Calendar as CalendarIcon, Network
} from 'lucide-react';

// --- TUS CREDENCIALES REALES (YA CONFIGURADAS) ---
const firebaseConfig = {
  apiKey: "AIzaSyD4oU6BxzgRuP8wj4aQAvUtcDpvMSR2mMQ",
  authDomain: "finanzas-familiares-7f59a.firebaseapp.com",
  projectId: "finanzas-familiares-7f59a",
  storageBucket: "finanzas-familiares-7f59a.firebasestorage.app",
  messagingSenderId: "24331042269",
  appId: "1:24331042269:web:54c6521656fd92abfb0a34",
  measurementId: "G-8X8KFTCKM0"
};

// --- NOMBRE DE TU COLECCIÓN EN FIREBASE ---
const appId = 'Finanzas_familia';

// --- INICIALIZACIÓN SEGURA ---
let app;
if (getApps().length > 0) {
  app = getApp();
} else {
  app = initializeApp(firebaseConfig);
}

const auth = getAuth(app);
const db = getFirestore(app);

// Helper formato moneda
const formatCompactCurrency = (value) => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${value}`;
};

// --- COMPONENTE DE RED ---
const NetworkExplorer = ({ messages = [], onSelectTag }) => {
  const [centerTag, setCenterTag] = useState(null);
  
  const { nodes, links, maxValue } = useMemo(() => {
    const nodeMap = {};
    let maxVal = 0;

    if (!messages) return { nodes: [], links: [], maxValue: 0 };

    if (!centerTag) {
      messages.forEach(msg => {
        if (!msg.amount || msg.type === 'income') return;
        msg.tags?.forEach(tag => {
          if (!nodeMap[tag]) nodeMap[tag] = { id: tag, value: 0, type: 'main' };
          nodeMap[tag].value += msg.amount;
        });
      });
      
      const sortedNodes = Object.values(nodeMap)
        .sort((a, b) => b.value - a.value)
        .slice(0, 7);

      maxVal = sortedNodes.length > 0 ? Math.max(...sortedNodes.map(n => n.value)) : 0;

      sortedNodes.forEach((n, i) => {
        const angle = (i / sortedNodes.length) * 2 * Math.PI - (Math.PI / 2);
        n.x = 50 + 30 * Math.cos(angle);
        n.y = 50 + 30 * Math.sin(angle);
      });

      return { nodes: sortedNodes, links: [], maxValue: maxVal };

    } else {
      let centerValue = 0;
      const relatedMap = {};

      messages.forEach(msg => {
        if (!msg.tags?.includes(centerTag) || !msg.amount) return;
        
        centerValue += msg.amount;

        msg.tags.forEach(t => {
          if (t === centerTag) return; 
          if (!relatedMap[t]) relatedMap[t] = 0;
          relatedMap[t] += msg.amount;
        });
      });

      const centerNode = { id: centerTag, value: centerValue, type: 'center', x: 50, y: 50 };
      
      const satelliteNodes = Object.keys(relatedMap)
        .map(key => ({ id: key, value: relatedMap[key], type: 'satellite' }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);

      maxVal = Math.max(centerValue, ...satelliteNodes.map(n => n.value));

      satelliteNodes.forEach((node, i) => {
        const angle = (i / satelliteNodes.length) * 2 * Math.PI;
        node.x = 50 + 32 * Math.cos(angle);
        node.y = 50 + 32 * Math.sin(angle);
      });

      const currentLinks = satelliteNodes.map(target => ({
        source: centerNode,
        target: target
      }));

      return { nodes: [centerNode, ...satelliteNodes], links: currentLinks, maxValue: maxVal };
    }
  }, [messages, centerTag]);

  return (
    <div className="relative w-full h-[450px] bg-slate-900 rounded-3xl overflow-hidden shadow-2xl flex items-center justify-center border border-slate-800">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/40 via-slate-900 to-black"></div>
      
      {centerTag && (
        <button 
          onClick={() => setCenterTag(null)}
          className="absolute top-4 left-4 bg-white/10 hover:bg-white/20 text-indigo-100 px-4 py-1.5 rounded-full text-xs backdrop-blur-md z-20 flex items-center gap-2 transition-all border border-white/10"
        >
          <X size={14} /> Volver
        </button>
      )}

      <svg viewBox="0 0 100 100" className="w-full h-full p-2 select-none">
        <defs>
          <radialGradient id="grad-main" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#3730a3" />
          </radialGradient>
          <radialGradient id="grad-center" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#f472b6" />
            <stop offset="100%" stopColor="#be185d" />
          </radialGradient>
          <radialGradient id="grad-sat" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0369a1" />
          </radialGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {links.map((link, i) => (
          <g key={`link-${i}`}>
             <line 
              x1={link.source.x} y1={link.source.y}
              x2={link.target.x} y2={link.target.y}
              stroke="url(#grad-line)" strokeWidth="0.5" strokeOpacity="0.4"
             />
             <line 
              x1={link.source.x} y1={link.source.y}
              x2={link.target.x} y2={link.target.y}
              stroke="white" strokeWidth="0.1" strokeOpacity="0.2" strokeDasharray="2" className="animate-pulse"
             />
          </g>
        ))}

        {nodes.map((node) => {
          const sizeRatio = maxValue > 0 ? node.value / maxValue : 0;
          const radius = node.type === 'center' ? 14 : 6 + (sizeRatio * 8);
          const fillId = node.type === 'center' ? 'url(#grad-center)' : node.type === 'main' ? 'url(#grad-main)' : 'url(#grad-sat)';

          return (
            <g 
              key={node.id} 
              onClick={() => { setCenterTag(node.id); onSelectTag(node.id); }}
              className="cursor-pointer transition-all duration-300 hover:opacity-90"
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            >
              <circle cx={node.x} cy={node.y + radius * 0.3} r={radius} fill="black" opacity="0.3" filter="url(#glow)" />
              <circle cx={node.x} cy={node.y} r={radius} fill={fillId} stroke="white" strokeWidth="0.3" strokeOpacity="0.3" />
              <text 
                x={node.x} y={node.y - (radius * 0.2)} textAnchor="middle" fill="white" 
                fontSize={Math.max(2.5, radius * 0.35)} fontWeight="bold" className="drop-shadow-md pointer-events-none"
              >
                {node.id.length > 10 ? node.id.substring(0,9)+'..' : node.id}
              </text>
              <text 
                x={node.x} y={node.y + (radius * 0.5)} textAnchor="middle" fill="rgba(255,255,255,0.9)" 
                fontSize={Math.max(2, radius * 0.3)} fontWeight="500" className="pointer-events-none"
              >
                {formatCompactCurrency(node.value)}
              </text>
            </g>
          );
        })}
      </svg>

      {!centerTag && (
        <div className="absolute bottom-6 text-indigo-200 text-xs bg-indigo-900/50 px-4 py-1 rounded-full backdrop-blur-sm border border-indigo-500/30">
          Toca una burbuja para ver detalles
        </div>
      )}
    </div>
  );
};

export default function FinanceApp() {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeTab, setActiveTab] = useState('chat'); 
  const messagesEndRef = useRef(null);
  const [selectedTagFilter, setSelectedTagFilter] = useState(null);
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [isClient, setIsClient] = useState(false); // FIX: Estado para controlar renderizado en cliente

  // --- AUTENTICACIÓN ---
  useEffect(() => {
    setIsClient(true); // FIX: Confirmamos que estamos en el cliente
    const initAuth = async () => {
        try {
            await signInAnonymously(auth);
        } catch (error) {
            console.error("Error auth:", error);
        }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- BASE DE DATOS (LECTURA) ---
  useEffect(() => {
    if (!user) return;
    
    // Escuchar la colección correcta
    const q = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'consolidated_finances'),
      orderBy('createdAt', 'desc'), 
      limit(200)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).reverse();
      setMessages(msgs);
      if(activeTab === 'chat') setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }, (error) => {
        console.error("Error leyendo datos:", error);
    });
    return () => unsubscribe();
  }, [user, activeTab]);

  const handleDelete = async (id) => {
    if (!user) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'consolidated_finances', id));
  };

  // --- FILTROS Y ESTADÍSTICAS ---
  const getFilteredMessages = () => {
    return messages.filter(msg => {
      if (!msg.createdAt) return false;
      const msgDate = new Date(msg.createdAt.seconds * 1000);
      
      if (dateFilter.start) {
        const startDate = new Date(dateFilter.start);
        if (msgDate < startDate) return false;
      }
      if (dateFilter.end) {
        const endDate = new Date(dateFilter.end);
        endDate.setHours(23, 59, 59); 
        if (msgDate > endDate) return false;
      }
      return true;
    });
  };

  const currentMessages = getFilteredMessages();

  const calculateStats = (filteredMsgs) => {
    let totalIncome = 0;
    let totalExpense = 0;
    const tagMap = {}; 

    filteredMsgs.forEach(msg => {
      if (!msg.amount) return;
      if (msg.type === 'income') {
        totalIncome += msg.amount;
      } else {
        totalExpense += msg.amount;
        if (msg.tags && Array.isArray(msg.tags)) {
          msg.tags.forEach(tag => {
            if (!tagMap[tag]) tagMap[tag] = 0;
            tagMap[tag] += msg.amount;
          });
        }
      }
    });

    const sortedTags = Object.keys(tagMap)
      .map(key => ({ name: key, value: tagMap[key] }))
      .sort((a, b) => b.value - a.value);

    return { totalIncome, totalExpense, sortedTags, balance: totalIncome - totalExpense };
  };

  const { totalIncome, totalExpense, sortedTags, balance } = calculateStats(currentMessages);

  const messagesForTagModal = selectedTagFilter 
    ? currentMessages.filter(m => m.tags && m.tags.includes(selectedTagFilter))
    : [];

  // FIX: Prevenir renderizado en servidor (evita pantalla negra)
  if (!isClient) return null;

  // --- RENDERIZADO ---
  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans text-slate-800">
      
      <header className="bg-white px-4 py-3 shadow-sm z-10 flex justify-between items-center border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl shadow-indigo-200 shadow-lg">
            <TrendingUp className="text-white w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight text-slate-800">Finanzas Hogar</h1>
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-600">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              En línea
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-full border border-slate-200">
          <CloudLightning size={12} className="text-blue-500" />
          <span className="text-[10px] text-slate-500 font-medium">Telegram Bot</span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto bg-slate-50/50">
        
        {activeTab === 'chat' && (
          <div className="p-4 pb-24 space-y-6">
            {messages.length === 0 && (
              <div className="text-center py-10 opacity-50">
                <MessageSquare className="mx-auto w-12 h-12 mb-2" />
                <p>Esperando mensajes desde Telegram...</p>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col animate-in slide-in-from-bottom-2 duration-300 ${msg.sender === 'Yo' ? 'items-end' : 'items-start'}`}>
                <div className={`flex items-end gap-2 max-w-[90%] ${msg.sender === 'Yo' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-sm ${msg.sender === 'Yo' ? 'bg-indigo-500' : 'bg-pink-500'}`}>
                    {msg.sender === 'Yo' ? 'Y' : 'E'}
                  </div>
                  <div className={`p-3 rounded-2xl shadow-sm border ${msg.sender === 'Yo' ? 'bg-white border-indigo-50 rounded-tr-none' : 'bg-white border-pink-50 rounded-tl-none'}`}>
                    <p className="text-sm text-slate-600 mb-2 italic">"{msg.originalText || msg.text}"</p>
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 min-w-[200px]">
                      <div className="flex justify-between items-start mb-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${msg.type === 'income' ? 'bg-green-100 text-green-700' : msg.type === 'debt_payment' ? 'bg-orange-100 text-orange-700' : 'bg-red-50 text-red-600'}`}>
                          {msg.type === 'income' ? 'INGRESO' : msg.type === 'debt_payment' ? 'PAGO DEUDA' : 'GASTO'}
                        </span>
                        <span className="font-bold text-slate-800 text-lg">${msg.amount?.toLocaleString()}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {msg.tags?.map((tag, idx) => (
                          <span key={idx} className="text-[10px] bg-white border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded-md flex items-center gap-1"><Tag size={10} /> {tag}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(msg.id)} className="text-slate-300 hover:text-red-400 p-1"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}

        {activeTab === 'explore' && (
          <div className="p-4 space-y-6 pb-24">
             <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-4">
               <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Network className="text-indigo-600" /> Mapa de Gastos</h2>
               <p className="text-xs text-slate-500">Visualización interactiva de tu ecosistema financiero.</p>
             </div>
             <NetworkExplorer messages={currentMessages} onSelectTag={setSelectedTagFilter} />
             {selectedTagFilter && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-4">
                  <div className="p-3 bg-indigo-50 border-b border-indigo-100 flex justify-between items-center">
                    <h3 className="font-bold text-indigo-900 text-sm">Detalle: {selectedTagFilter}</h3>
                    <span className="text-xs text-indigo-500 font-mono">Total: ${messagesForTagModal.reduce((sum, m) => sum + (m.amount||0), 0).toLocaleString()}</span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {messagesForTagModal.map(m => (
                      <div key={m.id} className="p-3 border-b border-slate-50 flex justify-between items-center text-sm hover:bg-slate-50 transition-colors">
                         <div>
                            <p className="text-slate-800 font-medium line-clamp-1">{m.originalText}</p>
                            <div className="flex gap-1 mt-1">{m.tags?.slice(0,3).map(t => (<span key={t} className="text-[9px] bg-slate-100 text-slate-500 px-1 rounded">{t}</span>))}</div>
                         </div>
                         <span className="font-bold text-slate-700 whitespace-nowrap">-${m.amount?.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
             )}
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="p-4 space-y-6 pb-24">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2"><CalendarIcon size={14} /> Rango de Fechas</h3>
              <div className="flex gap-2 items-center">
                <input type="date" value={dateFilter.start} onChange={(e) => setDateFilter(prev => ({ ...prev, start: e.target.value }))} className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-2 text-xs" />
                <input type="date" value={dateFilter.end} onChange={(e) => setDateFilter(prev => ({ ...prev, end: e.target.value }))} className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-2 text-xs" />
                {(dateFilter.start || dateFilter.end) && (<button onClick={() => setDateFilter({ start: '', end: '' })} className="p-2 bg-slate-100 rounded-lg"><X size={14}/></button>)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex items-center gap-2 mb-1 text-green-600"><TrendingUp size={16} /> <span className="text-xs font-bold uppercase">Ingresos</span></div>
                <p className="text-2xl font-bold text-slate-800">${totalIncome.toLocaleString()}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex items-center gap-2 mb-1 text-red-500"><TrendingDown size={16} /> <span className="text-xs font-bold uppercase">Egresos</span></div>
                <p className="text-2xl font-bold text-slate-800">${totalExpense.toLocaleString()}</p>
              </div>
            </div>
            <div className={`p-4 rounded-2xl shadow-sm border flex justify-between items-center ${balance >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
              <div><p className="text-xs font-bold uppercase mb-1 opacity-70">Liquidez</p><h2 className={`text-3xl font-bold ${balance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>${balance.toLocaleString()}</h2></div>
              <Wallet className={balance >= 0 ? "text-emerald-500" : "text-red-500"} size={24} />
            </div>
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><Filter size={18} /> Top Gastos</h3>
              <div className="space-y-3">
                {sortedTags.length > 0 ? sortedTags.slice(0, 10).map((tag, idx) => (
                  <div key={tag.name} className="flex justify-between items-center text-sm">
                      <span className="font-medium text-slate-700 w-1/3 truncate">{tag.name}</span>
                      <div className="flex-1 mx-2 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: totalExpense > 0 ? `${(tag.value / totalExpense) * 100}%` : '0%' }} /></div>
                      <span className="font-bold text-slate-800 text-xs w-20 text-right">${tag.value.toLocaleString()}</span>
                  </div>
                )) : (<p className="text-slate-400 text-sm text-center">Sin datos.</p>)}
              </div>
            </div>
          </div>
        )}
      </main>

      <nav className="bg-white border-t border-slate-100 flex justify-around p-1 z-30 pb-safe">
        <button onClick={() => setActiveTab('chat')} className={`p-3 rounded-xl transition-all ${activeTab === 'chat' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}><MessageSquare size={24} /></button>
        <button onClick={() => setActiveTab('explore')} className={`p-3 rounded-xl transition-all ${activeTab === 'explore' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}><Network size={24} /></button>
        <button onClick={() => setActiveTab('stats')} className={`p-3 rounded-xl transition-all ${activeTab === 'stats' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}><PieIcon size={24} /></button>
      </nav>
    </div>
  );
}
