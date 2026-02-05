import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, collection, onSnapshot, 
  query, orderBy, deleteDoc, doc, limit 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip
} from 'recharts';
import { 
  PieChart as PieIcon, MessageSquare, 
  Tag, TrendingUp, TrendingDown, Filter, X, Wallet, 
  Zap, CloudLightning, Calendar as CalendarIcon, Network, Trash2,
  ChevronRight, ChevronDown, Layers, Edit3, CornerDownRight, ArrowLeft, FolderOpen
} from 'lucide-react';

// --- CREDENCIALES REALES ---
const firebaseConfig = {
  apiKey: "AIzaSyD4oU6BxzgRuP8wj4aQAvUtcDpvMSR2mMQ",
  authDomain: "finanzas-familiares-7f59a.firebaseapp.com",
  projectId: "finanzas-familiares-7f59a",
  storageBucket: "finanzas-familiares-7f59a.firebasestorage.app",
  messagingSenderId: "24331042269",
  appId: "1:24331042269:web:54c6521656fd92abfb0a34",
  measurementId: "G-8X8KFTCKM0"
};

const appId = 'Finanzas_familia';

// --- INICIALIZACIÓN ---
let app;
if (getApps().length > 0) {
  app = getApp();
} else {
  app = initializeApp(firebaseConfig);
}

const auth = getAuth(app);
const db = getFirestore(app);

// Helper para fechas
const formatDateSafe = (createdAt) => {
  if (!createdAt || !createdAt.seconds) return '';
  try {
    return new Date(createdAt.seconds * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  } catch (e) { return ''; }
};

const formatCompactCurrency = (value) => {
  if (!value || isNaN(value)) return '$0';
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${(value / 1000).toFixed(0)}k`;
};

// --- LÓGICA DE JERARQUÍA (Para pestaña Stats) ---
// Organiza por frecuencia global (El tag más común es el padre)
const processHierarchy = (messages) => {
  const tagCounts = {};
  messages.forEach(msg => {
    if (msg.type === 'income' || !msg.tags) return;
    msg.tags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1);
  });

  const root = { name: 'root', value: 0, children: {} };

  messages.forEach(msg => {
    if (msg.type === 'income' || !msg.tags || msg.tags.length === 0) return;
    // Ordenar tags del mensaje: Más frecuente -> Menos frecuente
    const sortedTags = [...new Set(msg.tags)].sort((a, b) => (tagCounts[b] || 0) - (tagCounts[a] || 0));
    
    let currentNode = root;
    sortedTags.forEach((tag) => {
      if (!currentNode.children[tag]) currentNode.children[tag] = { name: tag, value: 0, children: {} };
      const node = currentNode.children[tag];
      node.value += msg.amount;
      currentNode = node;
    });
  });

  const convertToArray = (nodeMap) => {
    return Object.values(nodeMap)
      .map(node => ({ ...node, children: convertToArray(node.children).sort((a, b) => b.value - a.value) }))
      .sort((a, b) => b.value - a.value);
  };
  return convertToArray(root.children);
};

// --- COMPONENTE EXPLORADOR MULTIDIMENSIONAL (Carpetas Dinámicas) ---
const DynamicBubbleExplorer = ({ messages }) => {
  const [activeFilters, setActiveFilters] = useState([]); // Historial de tags seleccionados

  // 1. Filtrar mensajes que coinciden con TODAS las etiquetas seleccionadas
  const filteredMessages = useMemo(() => {
    if (activeFilters.length === 0) return messages.filter(m => m.type !== 'income');
    return messages.filter(msg => {
      if (msg.type === 'income' || !msg.tags) return false;
      return activeFilters.every(filter => msg.tags.includes(filter));
    });
  }, [messages, activeFilters]);

  // 2. Calcular qué etiquetas (burbujas) mostrar basadas en los mensajes filtrados
  const nextLevelBubbles = useMemo(() => {
    const tagMap = {};
    
    filteredMessages.forEach(msg => {
      // Solo mirar tags que NO están ya seleccionados
      const remainingTags = msg.tags.filter(t => !activeFilters.includes(t));
      
      remainingTags.forEach(tag => {
        if (!tagMap[tag]) tagMap[tag] = { name: tag, value: 0, count: 0 };
        tagMap[tag].value += msg.amount;
        tagMap[tag].count += 1;
      });
    });

    return Object.values(tagMap).sort((a, b) => b.value - a.value);
  }, [filteredMessages, activeFilters]);

  // Total en el nivel actual
  const currentTotal = filteredMessages.reduce((sum, m) => sum + (m.amount || 0), 0);

  const handleSelectTag = (tag) => {
    setActiveFilters([...activeFilters, tag]);
  };

  const handleGoBack = () => {
    setActiveFilters(activeFilters.slice(0, -1));
  };

  const handleReset = () => {
    setActiveFilters([]);
  };

  if (!messages || messages.length === 0) return <div className="text-center text-slate-400 p-10">Sin datos</div>;

  return (
    <div className="flex flex-col gap-4">
      {/* AREA VISUAL DE BURBUJAS */}
      <div className="h-[400px] bg-slate-900 rounded-3xl p-6 relative overflow-hidden flex flex-col items-center justify-center shadow-xl border border-slate-800">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-blue-900/30 via-slate-950 to-black"></div>
        
        {/* Barra de Navegación (Breadcrumbs) */}
        <div className="absolute top-4 left-4 z-20 flex flex-wrap gap-2 items-center">
          {activeFilters.length > 0 ? (
            <>
              <button onClick={handleGoBack} className="bg-white/10 text-white p-1.5 rounded-full hover:bg-white/20 transition-colors">
                <ArrowLeft size={16} />
              </button>
              <div className="flex gap-1 overflow-x-auto max-w-[200px] no-scrollbar">
                {activeFilters.map((tag, idx) => (
                  <span key={tag} className="text-xs bg-indigo-600/80 text-white px-2 py-1 rounded-md whitespace-nowrap border border-indigo-400/30 flex items-center gap-1">
                    {tag} <span className="opacity-50 text-[8px]">▶</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <span className="text-xs text-slate-500 font-medium px-2 uppercase tracking-widest flex items-center gap-2">
              <FolderOpen size={14}/> Todas las categorías
            </span>
          )}
        </div>

        {/* Burbujas Dinámicas */}
        <div className="z-10 flex flex-wrap content-center justify-center gap-3 max-w-sm animate-in zoom-in duration-300">
          {nextLevelBubbles.length > 0 ? nextLevelBubbles.slice(0, 7).map((item, idx) => {
            // Estilos dinámicos
            const isTop = idx === 0;
            const sizeClasses = isTop ? "w-28 h-28 text-base" : "w-20 h-20 text-xs";
            const bgClasses = isTop 
              ? "bg-gradient-to-br from-indigo-500 to-purple-600 shadow-indigo-500/40" 
              : "bg-slate-800 border border-slate-700 hover:border-indigo-500 hover:bg-slate-700";

            return (
              <button
                key={item.name}
                onClick={() => handleSelectTag(item.name)}
                className={`rounded-full flex flex-col items-center justify-center text-white shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 ${sizeClasses} ${bgClasses}`}
              >
                <span className="font-bold truncate max-w-[90%] capitalize">{item.name}</span>
                <span className="text-indigo-200 font-mono text-[10px] mt-0.5">{formatCompactCurrency(item.value)}</span>
              </button>
            );
          }) : (
            <div className="text-center p-4">
              <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-2">
                <Tag className="text-slate-500" />
              </div>
              <p className="text-slate-400 text-sm">No hay más subcategorías</p>
            </div>
          )}
        </div>

        {/* Pie de Info */}
        <div className="absolute bottom-4 w-full text-center pointer-events-none">
          <p className="text-slate-400 text-xs">Total en esta vista</p>
          <p className="text-white font-bold text-lg font-mono">${currentTotal.toLocaleString()}</p>
        </div>
      </div>

      {/* LISTA DE TRANSACCIONES FILTRADAS */}
      {activeFilters.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-4">
          <div className="p-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
            <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2">
              <Filter size={14}/> Detalles: {activeFilters.join(' + ')}
            </h3>
            <button onClick={handleReset} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
              <X size={12}/> Limpiar filtro
            </button>
          </div>
          
          <div className="max-h-[300px] overflow-y-auto">
            {filteredMessages.map(m => (
              <div key={m.id} className="p-3 border-b border-slate-50 flex justify-between items-center text-sm hover:bg-slate-50 transition-colors">
                  <div>
                    <p className="text-slate-800 font-medium line-clamp-1">{m.originalText}</p>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {m.tags?.map(t => (
                        <span key={t} className={`text-[9px] px-1.5 py-0.5 rounded border ${activeFilters.includes(t) ? 'bg-indigo-100 border-indigo-200 text-indigo-700 font-bold' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-slate-700 block">-${m.amount?.toLocaleString()}</span>
                    <span className="text-[9px] text-slate-400">{formatDateSafe(m.createdAt)}</span>
                  </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- FILA JERÁRQUICA (Stats) ---
const HierarchyRow = ({ item, level = 0, total }) => {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  const paddingLeft = level * 16; 

  return (
    <div className="border-b border-slate-50 last:border-0">
      <div 
        className={`flex justify-between items-center py-3 pr-2 cursor-pointer transition-colors ${level > 0 ? 'hover:bg-slate-50' : 'hover:bg-indigo-50/20'}`}
        style={{ paddingLeft: `${paddingLeft + 8}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {hasChildren ? (
            expanded ? <ChevronDown size={14} className="text-slate-400 shrink-0"/> : <ChevronRight size={14} className="text-slate-400 shrink-0"/>
          ) : (
            level > 0 ? <CornerDownRight size={12} className="text-slate-300 shrink-0 ml-0.5"/> : <div className="w-3.5"/>
          )}
          
          <div className="min-w-0">
            <span className={`block truncate ${level === 0 ? 'font-bold text-slate-700' : 'font-medium text-slate-600 text-sm'}`}>
              {item.name}
            </span>
            {level === 0 && (
              <div className="w-20 h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
                <div className="h-full bg-indigo-500" style={{ width: `${Math.min((item.value / total) * 100, 100)}%` }}></div>
              </div>
            )}
          </div>
        </div>
        <span className={`font-mono ${level === 0 ? 'text-slate-800 font-bold' : 'text-slate-500 text-xs'}`}>
          ${item.value.toLocaleString()}
        </span>
      </div>

      {expanded && hasChildren && (
        <div className="bg-slate-50/30 border-l-2 border-indigo-100 ml-4 mb-2 rounded-r-lg">
          {item.children.map((child) => (
            <HierarchyRow key={child.name} item={child} level={level + 1} total={item.value} />
          ))}
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
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    const initAuth = async () => {
        try { await signInAnonymously(auth); } catch (e) { console.error(e); }
    };
    initAuth();
    onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'consolidated_finances'),
      orderBy('createdAt', 'desc'), 
      limit(200)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).reverse();
      setMessages(msgs);
      if(activeTab === 'chat') setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    });
    return () => unsubscribe();
  }, [user, activeTab]);

  const handleDelete = async (id) => {
    if (!user) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'consolidated_finances', id));
  };

  const getFilteredMessages = () => {
    return messages.filter(msg => {
      if (!msg.createdAt) return false;
      const msgDate = new Date(msg.createdAt.seconds * 1000);
      if (dateFilter.start && msgDate < new Date(dateFilter.start)) return false;
      if (dateFilter.end) {
        const d = new Date(dateFilter.end); d.setHours(23,59,59);
        if (msgDate > d) return false;
      }
      return true;
    });
  };

  const currentMessages = getFilteredMessages();
  
  // Procesar para lista jerárquica
  const hierarchyData = useMemo(() => processHierarchy(currentMessages), [currentMessages]);

  const totalIncome = currentMessages.filter(m => m.type === 'income').reduce((acc, m) => acc + (m.amount || 0), 0);
  const totalExpense = currentMessages.filter(m => m.type !== 'income').reduce((acc, m) => acc + (m.amount || 0), 0);
  const balance = totalIncome - totalExpense;

  if (!isClient) return null;

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans text-slate-800">
      
      {/* HEADER */}
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
        <div className="bg-slate-100 px-2 py-1 rounded-full border border-slate-200">
          <CloudLightning size={12} className="text-blue-500" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto bg-slate-50/50">
        
        {/* CHAT TAB */}
        {activeTab === 'chat' && (
          <div className="p-4 pb-24 space-y-6">
            {messages.length === 0 && <div className="text-center py-10 opacity-50"><MessageSquare className="mx-auto mb-2"/>Esperando datos...</div>}
            
            {messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.sender === 'Yo' ? 'items-end' : 'items-start'}`}>
                <div className={`flex items-end gap-2 max-w-[90%] ${msg.sender === 'Yo' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-bold shadow-sm ${msg.sender === 'Yo' ? 'bg-indigo-500' : 'bg-pink-500'}`}>
                    {msg.sender === 'Yo' ? 'Y' : 'E'}
                  </div>
                  <div className={`p-3 rounded-2xl shadow-sm border text-sm ${msg.sender === 'Yo' ? 'bg-white rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                    <p className="mb-2 text-slate-600">"{msg.originalText}"</p>
                    <div className="bg-slate-50 rounded-xl p-2 border border-slate-100 min-w-[180px]">
                      <div className="flex justify-between items-center mb-1">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${msg.type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-600'}`}>
                          {msg.type === 'income' ? 'INGRESO' : 'GASTO'}
                        </span>
                        <span className="font-bold">${msg.amount?.toLocaleString()}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {Array.isArray(msg.tags) && msg.tags.map((t, i) => (
                          <span key={i} className="text-[9px] bg-white border px-1 rounded text-slate-500">{t}</span>
                        ))}
                      </div>
                      <div className="text-[9px] text-right text-slate-300 mt-1">{formatDateSafe(msg.createdAt)}</div>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDelete(msg.id)} 
                    className="text-slate-300 hover:text-red-400 p-2"
                    title="Eliminar este registro"
                  >
                    <Trash2 size={16}/>
                  </button>
                </div>
              </div>
            ))}
            
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* EXPLORE TAB (NUEVO MULTIDIMENSIONAL) */}
        {activeTab === 'explore' && (
          <div className="p-4 space-y-6 pb-24">
             <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-4">
               <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Network className="text-indigo-600" /> Mapa Dinámico</h2>
               <p className="text-xs text-slate-500">Filtra tocando las categorías.</p>
             </div>
             
             {/* Componente de Burbujas Multidimensionales */}
             <DynamicBubbleExplorer messages={currentMessages} />
          </div>
        )}

        {/* STATS TAB (LISTA JERÁRQUICA) */}
        {activeTab === 'stats' && (
          <div className="p-4 space-y-6 pb-24">
            
            {/* Filtros */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="text-xs font-bold text-slate-400 uppercase mb-2 flex gap-2"><CalendarIcon size={14}/> Fechas</h3>
              <div className="flex gap-2">
                <input type="date" value={dateFilter.start} onChange={(e) => setDateFilter(prev => ({...prev, start: e.target.value}))} className="flex-1 bg-slate-50 border rounded-lg px-2 py-2 text-xs"/>
                <input type="date" value={dateFilter.end} onChange={(e) => setDateFilter(prev => ({...prev, end: e.target.value}))} className="flex-1 bg-slate-50 border rounded-lg px-2 py-2 text-xs"/>
                {(dateFilter.start || dateFilter.end) && <button onClick={() => setDateFilter({start:'', end:''})} className="p-2 bg-slate-100 rounded"><X size={14}/></button>}
              </div>
            </div>

            {/* Resumen */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white p-4 rounded-2xl border border-slate-100">
                <div className="text-green-600 text-xs font-bold mb-1 flex gap-1"><TrendingUp size={14}/> INGRESOS</div>
                <div className="text-xl font-bold">${totalIncome.toLocaleString()}</div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-100">
                <div className="text-red-500 text-xs font-bold mb-1 flex gap-1"><TrendingDown size={14}/> EGRESOS</div>
                <div className="text-xl font-bold">${totalExpense.toLocaleString()}</div>
              </div>
            </div>

            {/* LISTA JERÁRQUICA (Ordenada por Frecuencia/Importancia) */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><Filter size={18} /> Top Gastos</h3>
              <div className="space-y-1">
                {hierarchyData.length > 0 ? hierarchyData.map((item) => (
                  <HierarchyRow key={item.name} item={item} total={totalExpense} />
                )) : <div className="text-center text-slate-400 py-4 text-sm">No hay gastos registrados</div>}
              </div>
            </div>

          </div>
        )}
      </main>

      {/* NAV */}
      <nav className="bg-white border-t border-slate-100 flex justify-around p-1 z-30 pb-safe">
        <button onClick={() => setActiveTab('chat')} className={`p-3 rounded-xl transition-all ${activeTab === 'chat' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}><MessageSquare size={24} /></button>
        <button onClick={() => setActiveTab('explore')} className={`p-3 rounded-xl transition-all ${activeTab === 'explore' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}><Network size={24} /></button>
        <button onClick={() => setActiveTab('stats')} className={`p-3 rounded-xl transition-all ${activeTab === 'stats' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}><PieIcon size={24} /></button>
      </nav>
    </div>
  );
}
