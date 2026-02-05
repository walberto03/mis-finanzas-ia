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
  ChevronRight, ChevronDown, Layers, Edit3, CornerDownRight
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

// --- LÓGICA DE JERARQUÍA PROFUNDA (MULTI-NIVEL) ---
const processHierarchy = (messages) => {
  const tagCounts = {};
  
  // 1. Contar frecuencias globales para determinar jerarquía
  messages.forEach(msg => {
    if (msg.type === 'income' || !msg.tags) return;
    msg.tags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1);
  });

  const root = { name: 'root', value: 0, children: {} };

  messages.forEach(msg => {
    if (msg.type === 'income' || !msg.tags || msg.tags.length === 0) return;

    // Ordenar tags por frecuencia (Mayor frecuencia = Padre / Categoría más grande)
    // Ej: [Transporte(10), Gas(5), Sofi(1)] -> Transporte > Gas > Sofi
    const sortedTags = [...new Set(msg.tags)].sort((a, b) => {
      const diff = (tagCounts[b] || 0) - (tagCounts[a] || 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    });

    let currentNode = root;
    
    // Construir el árbol nodo por nodo
    sortedTags.forEach((tag) => {
      if (!currentNode.children[tag]) {
        currentNode.children[tag] = { 
          name: tag, 
          value: 0, 
          children: {} // Recursividad
        };
      }
      
      const node = currentNode.children[tag];
      node.value += msg.amount; // Sumar valor al nodo actual
      currentNode = node; // Bajar un nivel
    });
  });

  // Convertir objeto a array recursivamente
  const convertToArray = (nodeMap) => {
    return Object.values(nodeMap)
      .map(node => ({
        ...node,
        children: convertToArray(node.children).sort((a, b) => b.value - a.value)
      }))
      .sort((a, b) => b.value - a.value);
  };

  return convertToArray(root.children);
};

// --- COMPONENTE BUBBLE EXPLORER CON NAVEGACIÓN PROFUNDA ---
const BubbleExplorer = ({ data }) => {
  const [history, setHistory] = useState([]); // Historial de navegación
  const currentView = history.length === 0 ? data : (history[history.length - 1].children || []);
  const currentParent = history.length > 0 ? history[history.length - 1] : null;

  const handleDrillDown = (item) => {
    if (item.children && item.children.length > 0) {
      setHistory([...history, item]);
    }
  };

  const handleBack = () => {
    setHistory(history.slice(0, -1));
  };

  if (!data || data.length === 0) return <div className="text-center text-slate-400 p-10">Sin datos</div>;

  return (
    <div className="h-[420px] bg-slate-900 rounded-3xl p-6 relative overflow-hidden flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300 shadow-2xl border border-slate-800">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-indigo-900/40 via-slate-950 to-black"></div>
      
      {/* Botón Volver o Título */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        {history.length > 0 ? (
          <button 
            onClick={handleBack}
            className="bg-white/10 text-white px-3 py-1.5 rounded-full text-xs hover:bg-white/20 flex items-center gap-1 backdrop-blur-md transition-all border border-white/10"
          >
            <X size={14} /> {currentParent.name}
          </button>
        ) : (
          <span className="text-xs text-slate-500 font-medium px-2">Vista Global</span>
        )}
      </div>

      {/* Contenedor de Burbujas */}
      <div className="z-10 flex flex-wrap content-center justify-center gap-4 max-w-sm">
        {currentView.slice(0, 6).map((item, idx) => {
          // Si estamos en la raíz, la primera burbuja es gigante
          const isBig = idx === 0 && history.length === 0;
          const sizeClasses = isBig ? "w-32 h-32 text-lg" : "w-24 h-24 text-sm";
          const colorClasses = isBig 
            ? "from-indigo-600 to-violet-600 shadow-indigo-500/20" 
            : "from-slate-800 to-slate-700 hover:from-indigo-600 hover:to-violet-600 border border-white/5";

          return (
            <button
              key={item.name}
              onClick={() => handleDrillDown(item)}
              disabled={item.children.length === 0}
              className={`rounded-full bg-gradient-to-br ${colorClasses} flex flex-col items-center justify-center text-white shadow-xl transition-all duration-300 hover:scale-105 active:scale-95 ${sizeClasses} relative group`}
            >
              <span className="font-bold truncate max-w-[85%] capitalize">{item.name}</span>
              <span className="text-indigo-200/80 font-mono text-xs mt-0.5">{formatCompactCurrency(item.value)}</span>
              
              {/* Indicador de que hay más contenido dentro */}
              {item.children.length > 0 && (
                <div className="absolute bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronDown size={12} className="text-white/50" />
                </div>
              )}
            </button>
          );
        })}
      </div>
      
      {currentView.length === 0 && (
        <p className="text-slate-500 text-sm z-10">No hay subcategorías</p>
      )}

      <div className="absolute bottom-4 w-full text-center text-[10px] text-slate-600 pointer-events-none">
        {history.length === 0 ? "Toca una categoría para entrar" : "Toca para ver detalles"}
      </div>
    </div>
  );
};

// --- COMPONENTE FILA JERÁRQUICA RECURSIVA ---
const HierarchyRow = ({ item, level = 0, total }) => {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  
  // Sangría visual basada en el nivel
  const paddingLeft = level * 16; 

  return (
    <div className="border-b border-slate-50 last:border-0">
      <div 
        className={`flex justify-between items-center py-3 pr-2 cursor-pointer transition-colors ${level > 0 ? 'hover:bg-slate-50' : 'hover:bg-indigo-50/30'}`}
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

      {/* Renderizado Recursivo de Hijos */}
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

  // --- FILTRADO ---
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
  
  // Procesar datos para jerarquía infinita
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

        {/* EXPLORE TAB (BUBBLES HTML) */}
        {activeTab === 'explore' && (
          <div className="p-4 space-y-6 pb-24">
             <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-4">
               <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Network className="text-indigo-600" /> Mapa de Gastos</h2>
               <p className="text-xs text-slate-500">Navega por tus categorías (Toca para entrar).</p>
             </div>
             
             <BubbleExplorer data={hierarchyData} />
          </div>
        )}

        {/* STATS TAB (LISTA RECURSIVA MEJORADA) */}
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

            {/* LISTA JERÁRQUICA INFINITA */}
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
