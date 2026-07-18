import React, { useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import './ScimplifyDashboard.css';
import logo from './assets/logo.svg';

const API = 'https://script.google.com/macros/s/AKfycbyJQx_DdG007gWEV0vspq7LTUmIuLZJsH061gk9WpuQF_6AjrgnlbejuMUCGmE_A92B/exec';
const DPO_IMP_API = 'https://script.google.com/macros/s/AKfycbyO_jKRmDG0ahswyor8Hack8lbSEhcJ55k4LFkSbeWJz5dTq2kWQC6rtcBT03QQ3pc1/exec';
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sumF = (arr, k) => arr.reduce((s, r) => s + (parseFloat(r[k]) || 0), 0);
const wDpo = rows => {
  const total = sumF(rows, 'Amount in INR');
  return total > 0 ? rows.reduce((s, r) => s + r['Amount in INR'] * r.DPO, 0) / total : 0;
};
const fmt = n => {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};
const fmtFull = n => `₹${Math.round(n).toLocaleString('en-IN')}`;
const dpoPill = d => {
  if (d >= 90) return <span className="pill p-o">{d}d</span>;
  if (d >= 30) return <span className="pill p-b">{d}d</span>;
  return <span className="pill p-g">{d}d</span>;
};
const isDom = r => ((r.Country || '').trim().toLowerCase() === 'india');
const isImp = r => !isDom(r);
const uniq = (arr, k) => [...new Set(arr.map(r => r[k]).filter(Boolean))].sort();

function getFY(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  const m = dt.getMonth();
  const y = dt.getFullYear();
  const s = m >= 3 ? y : y - 1;
  return `FY ${s}-${String(s + 1).slice(2)}`;
}

function normalize(rows) {
  return rows.map(r => {
    const o = {};
    Object.keys(r).forEach(k => { o[k.trim()] = r[k] === null || r[k] === undefined ? '' : r[k]; });
    const g = keys => {
      const key = keys.find(x => Object.prototype.hasOwnProperty.call(o, x));
      return key ? o[key] : '';
    };
    const raw = String(g(['PO_date_str', 'PO date', 'PO Date', 'PODate']) || '');
    const dt = new Date(raw);
    const ds = isNaN(dt) ? raw.slice(0, 10) : dt.toISOString().slice(0, 10);
    const mon = isNaN(dt) ? '' : `${MO[dt.getMonth()]} ${dt.getFullYear()}`;
    const country = String(g(['Country', 'country']) || '').trim();

    return {
      Supplier: String(g(['Supplier', 'supplier', 'SUPPLIER', 'Vendor']) || '').trim(),
      'PO no.': String(g(['PO no.', 'PO No.', 'PO Number', 'po_number', 'PO_no']) || '').trim(),
      POC: String(g(['POC', 'poc', 'Buyer', 'buyer']) || '').trim(),
      BU: String(g(['BU', 'bu', 'Business Unit']) || '').trim(),
      Product: String(g(['Product', 'product', 'PRODUCT', 'Item', 'item']) || '').trim(),
      'Payment terms': String(g(['Payment terms', 'Payment Terms', 'payment_terms']) || '').trim(),
      UOM: String(g(['UOM', 'uom', 'Unit']) || '').trim(),
      'Amount in INR': parseFloat(g(['Amount in INR', 'Amount', 'amount']) || 0) || 0,
      DPO: parseInt(g(['DPO', 'dpo', 'Days']) || 0, 10) || 0,
      qty: parseFloat(g(['qty', 'Qty', 'QTY', 'quantity']) || 0) || 0,
      Country: country,
      Entity: String(g(['Entity', 'entity']) || '').trim(),
      PO_date_str: ds,
      Month_Year: mon,
    };
  }).filter(r => r.Supplier && r['Amount in INR'] > 0);
}

function nearestTo80(pcts) {
  let cum = 0;
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < pcts.length; i += 1) {
    cum += pcts[i];
    const d = Math.abs(cum - 80);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function paretoRows(rows) {
  const map = {};
  rows.forEach(r => {
    const s = r.Supplier;
    if (!map[s]) map[s] = { v: 0, c: 0, dw: 0 };
    map[s].v += r['Amount in INR'];
    map[s].c += 1;
    map[s].dw += r['Amount in INR'] * r.DPO;
  });
  const tot = Object.values(map).reduce((sum, v) => sum + v.v, 0);
  const sorted = Object.entries(map).sort((a, b) => b[1].v - a[1].v);
  const si = nearestTo80(sorted.map(([, v]) => v.v / tot * 100));
  let cum = 0;
  const top80 = [];
  const bot20 = [];
  sorted.forEach(([sup, v], i) => {
    const pct = v.v / tot * 100;
    cum += pct;
    const wdpo = v.v > 0 ? v.dw / v.v : 0;
    const entry = {
      rank: i + 1,
      supplier: sup,
      value: v.v,
      count: v.c,
      pct,
      cum: parseFloat(cum.toFixed(1)),
      top: false,
      wdpo,
    };
    const isTop = si === -1 ? cum <= 83 : i <= si;
    entry.top = isTop;
    if (isTop) top80.push(entry);
    else bot20.push(entry);
  });
  return { top80, bot20, total: tot, totalSupp: sorted.length };
}

const ScimplifyDashboard = () => {
  const [allData, setAllData] = useState([]);
  const [currentFy, setCurrentFy] = useState('Overall');
  const [liveStatus, setLiveStatus] = useState('Live');
  const [liveState, setLiveState] = useState('ok');
  const [themeDark, setThemeDark] = useState(false);

  const [openDropdown, setOpenDropdown] = useState(null);
  const [searchQueries, setSearchQueries] = useState({});
  const [analysisTab, setAnalysisTab] = useState('bu');

  const [selS, setSelS] = useState([]);
  const [selCnt, setSelCnt] = useState([]);
  const [selP, setSelP] = useState([]);
  const [selBU, setSelBU] = useState(null);
  const [selBuyer, setSelBuyer] = useState(null);
  const [selMBuyer, setSelMBuyer] = useState(null);
  const [selMonth, setSelMonth] = useState(null);

  const [supplierRows, setSupplierRows] = useState(null);
  const [buRows, setBuRows] = useState(null);
  const [buyerRows, setBuyerRows] = useState(null);

  const [monthResult, setMonthResult] = useState(null);
  const [monthDetailRows, setMonthDetailRows] = useState([]);

  const [paretoOpen, setParetoOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState({ level1: false, dom: false, imp: false });

  const [showDpoModal, setShowDpoModal] = useState(false);
  const [showSegModal, setShowSegModal] = useState(false);
  const [segType, setSegType] = useState('Import');
  const [segTab, setSegTab] = useState('80');

  const [showTotalPOModal, setShowTotalPOModal] = useState(false);
  const [tpoTab, setTpoTab] = useState('imp');

  const [showSuppModal, setShowSuppModal] = useState(false);
  const [suppTab, setSuppTab] = useState('all');
  const [suppSearch, setSuppSearch] = useState('');

  const [dpoImpData, setDpoImpData] = useState([]);
  const [dimSelPoc, setDimSelPoc] = useState(null);
  const [dimSelCnt, setDimSelCnt] = useState(null);
  const [dpoImpStatus, setDpoImpStatus] = useState('Click Refresh to load DPO Improvement data');

  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const selectedData = useMemo(() => {
    if (currentFy === 'Overall') return allData;
    return allData.filter(r => getFY(r.PO_date_str) === currentFy);
  }, [allData, currentFy]);

  const fyTabs = useMemo(() => {
    const fySet = new Set();
    allData.forEach(r => {
      const fy = getFY(r.PO_date_str);
      if (fy) fySet.add(fy);
    });
    return [...fySet].sort();
  }, [allData]);

  const supplierOptions = useMemo(() => uniq(selectedData, 'Supplier'), [selectedData]);
  const countryOptions = useMemo(() => uniq(selectedData, 'Country'), [selectedData]);
  const poOptions = useMemo(() => uniq(selectedData, 'PO no.'), [selectedData]);
  const buOptions = useMemo(() => ['(All BUs)', ...uniq(selectedData, 'BU')], [selectedData]);
  const buyerOptions = useMemo(() => ['(All Buyers)', ...uniq(selectedData, 'POC')], [selectedData]);
  const monthOptions = useMemo(() => {
    const months = [...new Set(selectedData.map(r => r.Month_Year).filter(Boolean))];
    return months.sort((a, b) => {
      const [ma, ya] = a.split(' ');
      const [mb, yb] = b.split(' ');
      return (+ya - +yb) || (MO.indexOf(ma) - MO.indexOf(mb));
    });
  }, [selectedData]);

  const latestFY = useMemo(() => (fyTabs.length ? fyTabs[fyTabs.length - 1] : null), [fyTabs]);
  const showDpoCard = currentFy === 'Overall' || currentFy === latestFY;

  const kpiValues = useMemo(() => {
    const total = sumF(selectedData, 'Amount in INR');
    const impR = selectedData.filter(isImp);
    const domR = selectedData.filter(isDom);
    const allSupp = new Set(selectedData.map(r => r.Supplier.trim()));
    const impSupp = new Set(impR.map(r => r.Supplier.trim()));
    const domSupp = new Set(domR.map(r => r.Supplier.trim()));
    const overlap = [...impSupp].filter(s => domSupp.has(s));
    return {
      dpo: wDpo(selectedData).toFixed(1),
      total: fmt(total),
      supp: allSupp.size,
      suppSub: overlap.length ? `${overlap.length} in both segments` : 'Unique across all POs',
      imp: fmt(sumF(impR, 'Amount in INR')),
      impSub: `${impSupp.size} unique suppliers`,
      dom: fmt(sumF(domR, 'Amount in INR')),
      domSub: `${domSupp.size} unique suppliers`,
      overlap,
    };
  }, [selectedData]);

  const paretoData = useMemo(() => {
    const map = {};
    selectedData.forEach(r => {
      const s = r.Supplier;
      if (!map[s]) map[s] = { v: 0, c: 0 };
      map[s].v += r['Amount in INR'];
      map[s].c += 1;
    });
    const total = Object.values(map).reduce((s, item) => s + item.v, 0);
    const sorted = Object.entries(map).sort((a, b) => b[1].v - a[1].v);
    const si = nearestTo80(sorted.map(([, v]) => v.v / total * 100));
    let cum = 0;
    return sorted.map(([sup, v], i) => {
      const pct = v.v / total * 100;
      cum += pct;
      return {
        rank: i + 1,
        supplier: sup,
        value: v.v,
        count: v.c,
        pct,
        cum: parseFloat(cum.toFixed(1)),
        top: si === -1 ? cum <= 83 : i <= si,
      };
    });
  }, [selectedData]);

  useEffect(() => {
    const handleClick = () => setOpenDropdown(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeDark ? 'dark' : '');
  }, [themeDark]);

  useEffect(() => {
    if (!allData.length) return;
    if (!showDpoCard && dpoImpData.length === 0) return;
  }, [allData, showDpoCard, dpoImpData.length]);

  useEffect(() => {
    if (!chartRef.current) return;
    const rows = selMBuyer ? selectedData.filter(r => r.POC === selMBuyer) : selectedData;
    const labels = [];
    const values = [];
    monthOptions.forEach(m => {
      const rowsForMonth = rows.filter(r => r.Month_Year === m);
      if (rowsForMonth.length > 0) {
        labels.push(m);
        values.push(parseFloat(wDpo(rowsForMonth).toFixed(1)));
      }
    });
    if (chartInstance.current) chartInstance.current.destroy();
    if (labels.length < 2) return;
    const ctx = chartRef.current.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 200);
    grad.addColorStop(0, 'rgba(3,197,174,0.55)');
    grad.addColorStop(0.5, 'rgba(3,197,174,0.18)');
    grad.addColorStop(1, 'rgba(0,99,92,0)');
    const textColor = themeDark ? '#9ab3c4' : '#7a93a6';
    chartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Wtd DPO',
          data: values,
          borderColor: '#03c5ae',
          backgroundColor: grad,
          borderWidth: 2.5,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#03c5ae',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          fill: true,
          tension: 0.42,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: themeDark ? '#1c2530' : '#fff',
            titleColor: '#03c5ae',
            bodyColor: textColor,
            borderColor: '#03c5ae44',
            borderWidth: 1,
            padding: 10,
            callbacks: { label: context => ` Wtd DPO: ${context.raw} days` },
          },
        },
        scales: {
          x: { grid: { color: themeDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)' }, ticks: { color: textColor, font: { size: 11 } } },
          y: { grid: { color: themeDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)' }, ticks: { color: textColor, font: { size: 11 } }, title: { display: true, text: 'DPO (days)', color: textColor, font: { size: 11 } }, beginAtZero: true },
        },
      },
    });
  }, [selectedData, selMBuyer, monthOptions, themeDark]);

  const loadData = React.useCallback(async () => {
    setLiveState('loading');
    setLiveStatus('Fetching live data...');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(API, { redirect: 'follow', signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json) || !json.length) throw new Error('No data returned');
      const normalized = normalize(json);
      setAllData(normalized);
      setCurrentFy('Overall');
      setLiveState('ok');
      setLiveStatus(`Live - ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setLiveState('error');
      setLiveStatus('Error - click to retry');
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredItems = (items, query) => {
    if (!query) return items;
    return items.filter(item => item.toLowerCase().includes(query.toLowerCase()));
  };

  const applyFy = fy => {
    setCurrentFy(fy);
    if (fy === 'Overall') {
      setCurrentFy('Overall');
    }
    if (fy !== 'Overall' && fy !== latestFY) {
      // hide DPO tracker for older FYs
    }
    setSupplierRows(null);
    setBuRows(null);
    setBuyerRows(null);
    setMonthResult(null);
    setMonthDetailRows([]);
  };

  const toggleValue = (item, values, setValues) => {
    const exists = values.includes(item);
    if (exists) setValues(values.filter(v => v !== item));
    else setValues([...values, item]);
  };

  const handleSearch = () => {
    let rows = selectedData;
    if (selS.length) rows = rows.filter(r => selS.includes(r.Supplier));
    if (selCnt.length) rows = rows.filter(r => selCnt.includes(r.Country));
    if (selP.length) rows = rows.filter(r => selP.includes(r['PO no.']));
    if (!rows.length) {
      window.alert('No records found.');
      return;
    }
    setSupplierRows(rows);
  };

  const handleClearSearch = () => {
    setSelS([]);
    setSelCnt([]);
    setSelP([]);
    setSupplierRows(null);
  };

  const handleBuSearch = () => {
    const buses = selBU && selBU !== '(All BUs)' ? [selBU] : uniq(selectedData, 'BU');
    const rows = selectedData.filter(r => buses.includes(r.BU));
    setBuRows(rows);
  };

  const handleClearBu = () => {
    setSelBU(null);
    setBuRows(null);
  };

  const handleBuyerSearch = () => {
    const buyers = selBuyer && selBuyer !== '(All Buyers)' ? [selBuyer] : uniq(selectedData, 'POC');
    const rows = selectedData.filter(r => buyers.includes(r.POC));
    setBuyerRows(rows);
  };

  const handleClearBuyer = () => {
    setSelBuyer(null);
    setBuyerRows(null);
  };

  const handleMonthSearch = () => {
    let rows = selectedData;
    if (selMBuyer && selMBuyer !== '(All Buyers)') rows = rows.filter(r => r.POC === selMBuyer);
    if (selMonth) rows = rows.filter(r => r.Month_Year === selMonth);
    if (!rows.length) {
      window.alert('No data for this selection.');
      return;
    }
    const avg = rows.reduce((s, r) => s + r.DPO, 0) / rows.length;
    const wd = wDpo(rows);
    const tot = sumF(rows, 'Amount in INR');
    setMonthResult({ buyer: selMBuyer, month: selMonth, avg, wd, tot, rows });
    setMonthDetailRows(rows);
  };

  const handleClearMonth = () => {
    setSelMBuyer(null);
    setSelMonth(null);
    setMonthResult(null);
    setMonthDetailRows([]);
  };

  const loadDPOImprove = async () => {
    setDpoImpStatus('Loading...');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(DPO_IMP_API, { redirect: 'follow', signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json) || !json.length) throw new Error('No data in sheet');
      const normalized = json.map(r => {
        const o = {};
        Object.keys(r).forEach(k => { o[k.trim()] = r[k] === null || r[k] === undefined ? '' : String(r[k]).trim(); });
        return {
          Product: o['Product'] || '',
          Supplier: o['Supplier'] || '',
          Country: o['Country'] || '',
          CurrentDPO: parseFloat(o['DPO']) || 0,
          TargetDPO: parseFloat(o['Targeted DPO Till EOY']) || 0,
          POC: o['POC'] || '',
        };
      }).filter(r => r.Supplier);
      setDpoImpData(normalized);
      setDpoImpStatus(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setDpoImpData([]);
      setDpoImpStatus('Error');
    }
  };

  const filteredDpoImpRows = useMemo(() => {
    let rows = dpoImpData;
    if (dimSelPoc) rows = rows.filter(r => r.POC === dimSelPoc);
    if (dimSelCnt) rows = rows.filter(r => r.Country === dimSelCnt);
    return rows;
  }, [dpoImpData, dimSelPoc, dimSelCnt]);

  const dpoImpSummary = useMemo(() => {
    if (!filteredDpoImpRows.length) return null;
    const avgCur = filteredDpoImpRows.reduce((s, r) => s + r.CurrentDPO, 0) / filteredDpoImpRows.length;
    const avgTgt = filteredDpoImpRows.reduce((s, r) => s + r.TargetDPO, 0) / filteredDpoImpRows.length;
    const achieved = filteredDpoImpRows.filter(r => r.CurrentDPO >= r.TargetDPO).length;
    return {
      count: filteredDpoImpRows.length,
      avgCur: avgCur.toFixed(1),
      avgTgt: avgTgt.toFixed(1),
      gap: (avgTgt - avgCur).toFixed(1),
      achieved,
      pending: filteredDpoImpRows.length - achieved,
    };
  }, [filteredDpoImpRows]);

  const supplierModalData = useMemo(() => {
    const impR = selectedData.filter(isImp);
    const domR = selectedData.filter(isDom);
    const impSet = new Set(impR.map(r => r.Supplier.trim()));
    const domSet = new Set(domR.map(r => r.Supplier.trim()));
    const curFy = currentFy === 'Overall' ? latestFY : currentFy;
    const index = fyTabs.indexOf(curFy);
    const prevFy = index > 0 ? fyTabs[index - 1] : null;
    const curData = allData.filter(r => getFY(r.PO_date_str) === curFy);
    const prevData = prevFy ? allData.filter(r => getFY(r.PO_date_str) === prevFy) : [];
    const curSet = new Set(curData.map(r => r.Supplier.trim()));
    const prevSet = new Set(prevData.map(r => r.Supplier.trim()));
    const allSet = new Set([...curData, ...prevData].map(r => r.Supplier.trim()));
    const overlap = [...impSet].filter(s => domSet.has(s));
    const newSupp = [...curSet].filter(s => !prevSet.has(s));
    const leftSupp = [...prevSet].filter(s => !curSet.has(s));
    const existSupp = [...curSet].filter(s => prevSet.has(s));

    const rows = [...allSet].sort().map(s => {
      const rowsForSupplier = selectedData.filter(r => r.Supplier.trim() === s);
      const inDomestic = domSet.has(s);
      const inImport = impSet.has(s);
      const countries = [...new Set(rowsForSupplier.map(r => r.Country).filter(Boolean))].join(', ') || '—';
      const yStatus = !prevFy ? '—' : curSet.has(s) && prevSet.has(s) ? 'Existing' : curSet.has(s) ? 'New' : 'Left';
      return {
        supplier: s,
        seg: inDomestic && inImport ? 'Both' : inDomestic ? 'Domestic' : 'Import',
        lines: rowsForSupplier.length,
        value: sumF(rowsForSupplier, 'Amount in INR'),
        wdpo: wDpo(rowsForSupplier),
        yStatus,
        countries,
      };
    });
    return { impSet, domSet, allSet, overlap, curFy, prevFy, newSupp, leftSupp, existSupp, rows };
  }, [selectedData, allData, currentFy, fyTabs, latestFY]);

  const filteredSuppRows = useMemo(() => {
    let rows = supplierModalData.rows;
    if (suppTab === 'dom') rows = rows.filter(r => r.seg === 'Domestic' || r.seg === 'Both');
    if (suppTab === 'imp') rows = rows.filter(r => r.seg === 'Import' || r.seg === 'Both');
    if (suppTab === 'ovlp') rows = rows.filter(r => r.seg === 'Both');
    if (suppTab === 'new') rows = rows.filter(r => r.yStatus === 'New');
    if (suppTab === 'exist') rows = rows.filter(r => r.yStatus === 'Existing');
    if (suppTab === 'left') rows = rows.filter(r => r.yStatus === 'Left');
    if (suppSearch) rows = rows.filter(r => r.supplier.toLowerCase().includes(suppSearch.toLowerCase()));
    return rows;
  }, [supplierModalData.rows, suppTab, suppSearch]);

  const handleShowSegment = type => {
    setSegType(type);
    setSegTab('80');
    setShowSegModal(true);
  };

  const handleShowTotalPO = () => {
    setTpoTab('imp');
    setShowTotalPOModal(true);
  };

  const handleSelectSuppTab = tab => {
    setSuppTab(tab);
  };

  const renderKpi = (label, value, sub, hint, onClick) => (
    <div className="kpi" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="kpi-lbl">{label}</div>
      <div className="kpi-val">{value}</div>
      <div className="kpi-sub">{sub}</div>
      <div className="kpi-hint">{hint}</div>
    </div>
  );

  const getSegmentRows = () => {
    const rows = segType === 'Import' ? selectedData.filter(isImp) : selectedData.filter(isDom);
    return paretoRows(rows);
  };

  const segmentRows = useMemo(() => getSegmentRows(), [segType, selectedData]);
  const segmentTotal = segmentRows.top80.reduce((s, item) => s + item.value, 0);
  const segmentWd = segmentTotal > 0 ? segmentRows.top80.reduce((s, item) => s + item.value * item.wdpo, 0) / segmentTotal : 0;

  const tpoRows = useMemo(() => ({
    imp: selectedData.filter(isImp),
    dom: selectedData.filter(isDom),
    both: (() => {
      const impSup = new Set(selectedData.filter(isImp).map(r => r.Supplier.trim()));
      const domSup = new Set(selectedData.filter(isDom).map(r => r.Supplier.trim()));
      const bothSup = new Set([...impSup].filter(s => domSup.has(s)));
      return selectedData.filter(r => bothSup.has(r.Supplier.trim()));
    })(),
  }), [selectedData]);

  const tpoData = useMemo(() => ({
    imp: paretoRows(tpoRows.imp),
    dom: paretoRows(tpoRows.dom),
    both: paretoRows(tpoRows.both || []),
  }), [tpoRows]);

  const tpoConcentration = useMemo(() => {
    const calc = (d) => {
      const top = d.top80.length;
      const total = d.totalSupp || 0;
      const pct = total ? (top / total * 100) : 0;
      return { top, total, pct: parseFloat(pct.toFixed(1)) };
    };
    return {
      imp: calc(tpoData.imp),
      dom: calc(tpoData.dom),
      both: calc(tpoData.both),
    };
  }, [tpoData]);

  const currentTpoConc = tpoConcentration[tpoTab] || { top: 0, total: 0, pct: 0 };

  const showModalOverlay = (setter) => (event) => {
    if (event.target === event.currentTarget) setter(false);
  };

  return (
    <div className="dashboard-root" onClick={() => setOpenDropdown(null)}>
      <header>
        <div className="logo-wrap">
          <img id="headerLogo" src={logo} alt="Scimplify logo" />
          <div>
            <div className="brand">Scimplify</div>
            <div className="brand-sub">Procurement Analytics</div>
          </div>
        </div>
        <div className="hdr-right">
          <span className="fy-badge">{currentFy}</span>
          <button className="live-badge" onClick={async () => { setLiveState('loading'); setLiveStatus('Refreshing...'); await loadData(); }}>
            <div className={`live-dot${liveState === 'error' ? ' error' : liveState === 'loading' ? ' loading' : ''}`} />
            <span>{liveStatus}</span>
          </button>
          <div className="tog-wrap">
            <span>☀</span>
            <button className={`tog${themeDark ? ' on' : ''}`} onClick={() => setThemeDark(prev => !prev)}>
              <div className="tog-knob">{themeDark ? '🌙' : '☀'}</div>
            </button>
            <span>🌙</span>
          </div>
        </div>
      </header>

      <div className="fy-tab-bar">
        <button className={`fy-tab-btn${currentFy === 'Overall' ? ' active' : ''}`} onClick={() => applyFy('Overall')}>Overall <span className="fy-tab-count">{allData.length} POs</span></button>
        {fyTabs.map(fy => (
          <button
            key={fy}
            className={`fy-tab-btn${currentFy === fy ? ' active' : ''}`}
            onClick={() => applyFy(fy)}
          >
            {fy} <span className="fy-tab-count">{allData.filter(r => getFY(r.PO_date_str) === fy).length} POs</span>
          </button>
        ))}
      </div>

      <main className="main">
        <div className="kpi-strip">
          {renderKpi('Weighted Avg DPO', kpiValues.dpo, 'All PO lines', '🔍 Click for breakdown', () => setShowDpoModal(true))}
          {renderKpi('Total PO Value', kpiValues.total, 'INR', '🔍 Import vs Domestic', () => setShowTotalPOModal(true))}
          {renderKpi('Unique Suppliers', kpiValues.supp, kpiValues.suppSub, '🔍 Click to view full list', () => setShowSuppModal(true))}
          {renderKpi('Import Spend', kpiValues.imp, 'Country ≠ India', '🔍 80/20 Analysis', () => { setSegType('Import'); setShowSegModal(true); })}
          {renderKpi('Domestic Spend', kpiValues.dom, 'Country = India', '🔍 80/20 Analysis', () => { setSegType('Domestic'); setShowSegModal(true); })}
        </div>

        {kpiValues.overlap.length ? (
          <div id="overlapNotice" style={{ marginBottom: 18 }}>
            <div style={{ background: '#f59e0b12', border: '1px solid #f59e0b44', borderRadius: 10, padding: '12px 18px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Supplier Overlap Detected</div>
                <div style={{ fontSize: 13, color: 'var(--text3)' }}>
                  {kpiValues.overlap.length} supplier{kpiValues.overlap.length > 1 ? 's' : ''} appear in both Import & Domestic: {kpiValues.overlap.map((item, idx) => <strong key={item}>{item}{idx < kpiValues.overlap.length - 1 ? ', ' : ''}</strong>)}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <section className="card">
          <div className="card-hdr"><div className="card-icon">🔍</div><div><div className="card-title">Supplier & PO Search</div><div className="card-sub">Filter by supplier, country and/or PO number</div></div></div>
          <div className="card-body">
            <div className="filter-row">
              <div className="fld">
                <div className="fld-lbl">Supplier</div>
                <div className="cs-wrap" onClick={e => e.stopPropagation()}>
                  <button className={`cs-btn${openDropdown === 'supplier' ? ' open' : ''}`} onClick={() => setOpenDropdown(openDropdown === 'supplier' ? null : 'supplier')}>
                    <span className="cs-val">{selS.length ? `${selS.slice(0, 2).join(', ')}${selS.length > 2 ? ' +more' : ''}` : 'Select suppliers...'}</span>
                    <span className="cs-arr">▼</span>
                  </button>
                  <div className={`cs-panel${openDropdown === 'supplier' ? ' show' : ''}`}>
                    <div className="cs-search"><input value={searchQueries.supplier || ''} onChange={e => setSearchQueries(prev => ({ ...prev, supplier: e.target.value }))} type="text" placeholder="Search..." /></div>
                    <div className="cs-list">
                      <div className="cs-item">
                        <input type="checkbox" checked={!selS.length} onChange={() => setSelS([])} />
                        <label style={{ cursor: 'pointer', flex: 1 }}>Select All</label>
                      </div>
                      {filteredItems(supplierOptions, searchQueries.supplier || '').map(item => (
                        <div key={item} className={`cs-item${selS.includes(item) ? ' sel' : ''}`}>
                          <input type="checkbox" checked={selS.includes(item)} onChange={() => toggleValue(item, selS, setSelS)} />
                          <label style={{ cursor: 'pointer', flex: 1 }}>{item}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="fld">
                <div className="fld-lbl">Country</div>
                <div className="cs-wrap" onClick={e => e.stopPropagation()}>
                  <button className={`cs-btn${openDropdown === 'country' ? ' open' : ''}`} onClick={() => setOpenDropdown(openDropdown === 'country' ? null : 'country')}>
                    <span className="cs-val">{selCnt.length ? `${selCnt.slice(0, 2).join(', ')}${selCnt.length > 2 ? ' +more' : ''}` : 'Select countries...'}</span>
                    <span className="cs-arr">▼</span>
                  </button>
                  <div className={`cs-panel${openDropdown === 'country' ? ' show' : ''}`}>
                    <div className="cs-search"><input value={searchQueries.country || ''} onChange={e => setSearchQueries(prev => ({ ...prev, country: e.target.value }))} type="text" placeholder="Search..." /></div>
                    <div className="cs-list">
                      <div className="cs-item">
                        <input type="checkbox" checked={!selCnt.length} onChange={() => setSelCnt([])} />
                        <label style={{ cursor: 'pointer', flex: 1 }}>Select All</label>
                      </div>
                      {filteredItems(countryOptions, searchQueries.country || '').map(item => (
                        <div key={item} className={`cs-item${selCnt.includes(item) ? ' sel' : ''}`}>
                          <input type="checkbox" checked={selCnt.includes(item)} onChange={() => toggleValue(item, selCnt, setSelCnt)} />
                          <label style={{ cursor: 'pointer', flex: 1 }}>{item}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="fld">
                <div className="fld-lbl">PO Number</div>
                <div className="cs-wrap" onClick={e => e.stopPropagation()}>
                  <button className={`cs-btn${openDropdown === 'po' ? ' open' : ''}`} onClick={() => setOpenDropdown(openDropdown === 'po' ? null : 'po')}>
                    <span className="cs-val">{selP.length ? `${selP.slice(0, 2).join(', ')}${selP.length > 2 ? ' +more' : ''}` : 'Select PO numbers...'}</span>
                    <span className="cs-arr">▼</span>
                  </button>
                  <div className={`cs-panel${openDropdown === 'po' ? ' show' : ''}`}>
                    <div className="cs-search"><input value={searchQueries.po || ''} onChange={e => setSearchQueries(prev => ({ ...prev, po: e.target.value }))} type="text" placeholder="Search..." /></div>
                    <div className="cs-list">
                      <div className="cs-item">
                        <input type="checkbox" checked={!selP.length} onChange={() => setSelP([])} />
                        <label style={{ cursor: 'pointer', flex: 1 }}>Select All</label>
                      </div>
                      {filteredItems(poOptions, searchQueries.po || '').map(item => (
                        <div key={item} className={`cs-item${selP.includes(item) ? ' sel' : ''}`}>
                          <input type="checkbox" checked={selP.includes(item)} onChange={() => toggleValue(item, selP, setSelP)} />
                          <label style={{ cursor: 'pointer', flex: 1 }}>{item}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <button className="btn-p" onClick={handleSearch}>Search</button>
              <button className="btn-g" onClick={handleClearSearch}>Clear</button>
            </div>

            {supplierRows ? (
              <div>
                <div className="meta-row">
                  <div className="meta"><div className="meta-lbl">Supplier(s)</div><div className="meta-val">{[...new Set(supplierRows.map(r => r.Supplier))].length > 1 ? `${[...new Set(supplierRows.map(r => r.Supplier))].length} suppliers` : [...new Set(supplierRows.map(r => r.Supplier))][0]}</div></div>
                  <div className="meta"><div className="meta-lbl">Country(s)</div><div className="meta-val">{[...new Set(supplierRows.map(r => r.Country).filter(Boolean))].length > 2 ? `${[...new Set(supplierRows.map(r => r.Country).filter(Boolean))].length} countries` : [...new Set(supplierRows.map(r => r.Country).filter(Boolean))].join(', ')}</div></div>
                  <div className="meta"><div className="meta-lbl">Total Amount</div><div className="meta-val lg">{fmtFull(sumF(supplierRows, 'Amount in INR'))}</div></div>
                  <div className="meta"><div className="meta-lbl">POC(s)</div><div className="meta-val">{[...new Set(supplierRows.map(r => r.POC))].join(', ')}</div></div>
                  <div className="meta"><div className="meta-lbl">Wtd Avg DPO</div><div className="meta-val">{wDpo(supplierRows).toFixed(1)} days</div></div>
                  <div className="meta"><div className="meta-lbl">PO Lines</div><div className="meta-val">{supplierRows.length}</div></div>
                </div>
                <div className="tbl-wrap"><table><thead><tr><th>#</th><th>BU</th><th>Country</th><th>Product</th><th>Qty</th><th>UOM</th><th>Amount (INR)</th><th>Payment Terms</th><th>DPO</th></tr></thead><tbody>
                  {supplierRows.map((r, idx) => (
                    <tr key={`${r.Supplier}-${idx}`}>
                      <td>{idx + 1}</td>
                      <td><span className="pill p-t">{r.BU}</span></td>
                      <td style={{ fontSize: 12 }}>{r.Country || '—'}</td>
                      <td style={{ maxWidth: 180, wordBreak: 'break-word' }}>{r.Product}</td>
                      <td className="tr">{(r.qty || 0).toLocaleString()}</td>
                      <td>{r.UOM}</td>
                      <td className="tr">{fmtFull(r['Amount in INR'])}</td>
                      <td style={{ maxWidth: 150, fontSize: 12 }}>{r['Payment terms']}</td>
                      <td>{dpoPill(r.DPO)}</td>
                    </tr>
                  ))}
                  <tr className="total-row"><td colSpan={6}>TOTAL / WTD AVG DPO</td><td className="tr">{fmtFull(sumF(supplierRows, 'Amount in INR'))}</td><td /></tr>
                </tbody></table></div>
              </div>
            ) : (
              <div className="empty"><div className="ico">🔍</div><p>Select a supplier or PO number and click Search</p></div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-hdr"><div className="card-icon">📊</div><div><div className="card-title">BU & Buyer Analysis</div><div className="card-sub">Deep-dive by Business Unit or Buyer / POC</div></div></div>
          <div className="tabs">
            <button className={`tab${analysisTab === 'bu' ? ' active' : ''}`} onClick={() => setAnalysisTab('bu')}>Business Unit (BU)</button>
            <button className={`tab${analysisTab === 'buyer' ? ' active' : ''}`} onClick={() => setAnalysisTab('buyer')}>Buyer / POC</button>
          </div>
          <div className={`tab-pane${analysisTab === 'bu' ? ' active' : ''}`}>
            <div className="card-body">
              <div className="filter-row">
                <div className="fld"><div className="fld-lbl">Business Unit</div><div className="cs-wrap" onClick={e => e.stopPropagation()}>
                  <button className={`cs-btn${openDropdown === 'bu' ? ' open' : ''}`} onClick={() => setOpenDropdown(openDropdown === 'bu' ? null : 'bu')}>
                    <span className="cs-val">{selBU || 'Select BU...'}</span>
                    <span className="cs-arr">▼</span>
                  </button>
                  <div className={`cs-panel${openDropdown === 'bu' ? ' show' : ''}`}>
                    <div className="cs-list">
                      {buOptions.map(item => (
                        <div key={item} className={`cs-item${selBU === item ? ' sel' : ''}`} onClick={() => { setSelBU(item === '(All BUs)' ? null : item); setOpenDropdown(null); }}>
                          <div className="cs-radio" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div></div>
                <button className="btn-p" onClick={handleBuSearch}>Analyse</button><button className="btn-g" onClick={handleClearBu}>Clear</button>
              </div>
              {buRows ? (
                <div>
                  <div className="meta-row">
                    <div className="meta"><div className="meta-lbl">BU(s)</div><div className="meta-val">{selBU || uniq(selectedData, 'BU').join(', ')}</div></div>
                    <div className="meta"><div className="meta-lbl">Total PO Value</div><div className="meta-val lg">{fmtFull(sumF(buRows, 'Amount in INR'))}</div></div>
                    <div className="meta"><div className="meta-lbl">PO Lines</div><div className="meta-val">{buRows.length}</div></div>
                    <div className="meta"><div className="meta-lbl">Wtd DPO</div><div className="meta-val">{wDpo(buRows).toFixed(1)} days</div></div>
                  </div>
                  <div className="tbl-wrap"><table><thead><tr><th>BU</th><th>Countries</th><th>Total PO Value (INR)</th><th>PO Count</th><th>Weighted DPO</th><th>Max DPO</th><th>Min DPO</th></tr></thead><tbody>
                    { (selBU ? [selBU] : uniq(selectedData, 'BU')).map(bu => {
                      const rows = selectedData.filter(x => x.BU === bu);
                      const countries = [...new Set(rows.map(x => x.Country).filter(Boolean))];
                      return (
                        <tr key={bu}>
                          <td><strong>{bu}</strong></td>
                          <td style={{ fontSize: 12 }}>{countries.length > 3 ? `${countries.length} countries` : countries.join(', ')}</td>
                          <td className="tr">{fmtFull(sumF(rows, 'Amount in INR'))}</td>
                          <td className="tr">{rows.length}</td>
                          <td>{dpoPill(Math.round(wDpo(rows)))} <span style={{ fontSize: 11, color: 'var(--text3)' }}>({wDpo(rows).toFixed(1)}d)</span></td>
                          <td><span className="pill p-o">{Math.max(...rows.map(x => x.DPO))}d</span></td>
                          <td><span className="pill p-g">{Math.min(...rows.map(x => x.DPO))}d</span></td>
                        </tr>
                      );
                    })}
                  </tbody></table></div>
                </div>
              ) : (
                <div className="empty"><div className="ico">🏢</div><p>Select a BU to see analysis</p></div>
              )}
            </div>
          </div>

          <div className={`tab-pane${analysisTab === 'buyer' ? ' active' : ''}`}>
            <div className="card-body">
              <div className="filter-row">
                <div className="fld"><div className="fld-lbl">Buyer / POC</div><div className="cs-wrap" onClick={e => e.stopPropagation()}>
                  <button className={`cs-btn${openDropdown === 'buyer' ? ' open' : ''}`} onClick={() => setOpenDropdown(openDropdown === 'buyer' ? null : 'buyer')}>
                    <span className="cs-val">{selBuyer || 'Select buyer...'}</span>
                    <span className="cs-arr">▼</span>
                  </button>
                  <div className={`cs-panel${openDropdown === 'buyer' ? ' show' : ''}`}>
                    <div className="cs-list">
                      {buyerOptions.map(item => (
                        <div key={item} className={`cs-item${selBuyer === item ? ' sel' : ''}`} onClick={() => { setSelBuyer(item === '(All Buyers)' ? null : item); setOpenDropdown(null); }}>
                          <div className="cs-radio" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div></div>
                <button className="btn-p" onClick={handleBuyerSearch}>Analyse</button><button className="btn-g" onClick={handleClearBuyer}>Clear</button>
              </div>
              {buyerRows ? (
                <div>
                  <div className="meta-row">
                    <div className="meta"><div className="meta-lbl">Buyer(s)</div><div className="meta-val">{selBuyer || uniq(selectedData, 'POC').join(', ')}</div></div>
                    <div className="meta"><div className="meta-lbl">Total PO Value</div><div className="meta-val lg">{fmtFull(sumF(buyerRows, 'Amount in INR'))}</div></div>
                    <div className="meta"><div className="meta-lbl">PO Lines</div><div className="meta-val">{buyerRows.length}</div></div>
                    <div className="meta"><div className="meta-lbl">Overall Wtd DPO</div><div className="meta-val">{wDpo(buyerRows).toFixed(1)} days</div></div>
                  </div>
                  <div className="tbl-wrap"><table><thead><tr><th>Buyer (POC)</th><th>Total PO Value (INR)</th><th>PO Count</th><th>Weighted DPO</th><th>BUs Covered</th><th>Countries</th><th>Suppliers</th></tr></thead><tbody>
                    { (selBuyer ? [selBuyer] : uniq(selectedData, 'POC')).map(b => {
                      const rows = selectedData.filter(x => x.POC === b);
                      const cnts = [...new Set(rows.map(x => x.Country).filter(Boolean))];
                      return (
                        <tr key={b}>
                          <td><strong>{b}</strong></td>
                          <td className="tr">{fmtFull(sumF(rows, 'Amount in INR'))}</td>
                          <td className="tr">{rows.length}</td>
                          <td>{dpoPill(Math.round(wDpo(rows)))} <span style={{ fontSize: 11, color: 'var(--text3)' }}>({wDpo(rows).toFixed(1)}d)</span></td>
                          <td style={{ fontSize: 12 }}>{[...new Set(rows.map(x => x.BU))].join(', ')}</td>
                          <td style={{ fontSize: 12 }}>{cnts.length > 3 ? `${cnts.length} countries` : cnts.join(', ')}</td>
                          <td className="tr">{new Set(rows.map(x => x.Supplier)).size}</td>
                        </tr>
                      );
                    })}
                  </tbody></table></div>
                </div>
              ) : (
                <div className="empty"><div className="ico">👤</div><p>Select a buyer to see analysis</p></div>
              )}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-hdr" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setParetoOpen(prev => !prev)}>
            <div className="card-icon">📈</div>
            <div style={{ flex: 1 }}><div className="card-title">Supplier Pareto Analysis (80/20)</div><div className="card-sub">Ranked by spend — click to expand / collapse</div></div>
            <div id="paretoChevron" style={{ transform: paretoOpen ? 'rotate(0deg)' : 'rotate(-90deg)', fontSize: 18, color: 'var(--c1)', marginLeft: 'auto', transition: 'transform .25s' }}>▼</div>
          </div>
          {paretoOpen ? (
            <div className="card-body"><div className="tbl-wrap"><table><thead><tr><th>Rank</th><th>Supplier</th><th>PO Value (INR)</th><th>PO Count</th><th>% Spend</th><th>Cumulative %</th><th>Category</th></tr></thead><tbody>
              {paretoData.map(row => (
                <tr key={row.supplier}>
                  <td>{row.rank}</td>
                  <td style={{ maxWidth: 220, wordBreak: 'break-word', fontSize: 12 }}>{row.supplier}</td>
                  <td className="tr">{fmtFull(row.value)}</td>
                  <td className="tr">{row.count}</td>
                  <td><div className="pbar-wrap"><div className="pbar-track"><div className="pbar-fill" style={{ width: `${Math.min(row.pct * 4, 100)}%` }} /></div><div className="pbar-pct">{row.pct.toFixed(1)}%</div></div></td>
                  <td>{row.cum.toFixed(1)}%</td>
                  <td><span className={`pill ${row.top ? 'p-top' : 'p-tail'}`}>{row.top ? '★ Top 80%' : 'Long Tail'}</span></td>
                </tr>
              ))}
            </tbody></table></div></div>
          ) : null}
        </section>

        <section className="card" style={{ overflow: 'visible' }}>
          <div className="card-hdr"><div className="card-icon">📅</div><div><div className="card-title">Month-wise DPO Trend by Buyer</div><div className="card-sub">Select buyer to view trend — optionally filter by month</div></div></div>
          <div className="card-body" style={{ overflow: 'visible' }}>
            <div className="filter-row">
              <div className="fld"><div className="fld-lbl">Buyer / POC</div><div className="cs-wrap" onClick={e => e.stopPropagation()}>
                <button className={`cs-btn${openDropdown === 'mb' ? ' open' : ''}`} onClick={() => setOpenDropdown(openDropdown === 'mb' ? null : 'mb')}>
                  <span className="cs-val">{selMBuyer || 'Select buyer...'}</span>
                  <span className="cs-arr">▼</span>
                </button>
                <div className={`cs-panel${openDropdown === 'mb' ? ' show' : ''}`}>
                  <div className="cs-list">
                    {buyerOptions.map(item => (
                      <div key={item} className={`cs-item${selMBuyer === item ? ' sel' : ''}`} onClick={() => { setSelMBuyer(item === '(All Buyers)' ? null : item); setOpenDropdown(null); }}>
                        <div className="cs-radio" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div></div>
              <div className="fld"><div className="fld-lbl">Month (optional)</div><div className="cs-wrap" onClick={e => e.stopPropagation()}>
                <button className={`cs-btn${openDropdown === 'month' ? ' open' : ''}`} onClick={() => setOpenDropdown(openDropdown === 'month' ? null : 'month')}>
                  <span className="cs-val">{selMonth || 'Select month...'}</span>
                  <span className="cs-arr">▼</span>
                </button>
                <div className={`cs-panel${openDropdown === 'month' ? ' show' : ''}`}>
                  <div className="cs-list">
                    {monthOptions.map(item => (
                      <div key={item} className={`cs-item${selMonth === item ? ' sel' : ''}`} onClick={() => { setSelMonth(item); setOpenDropdown(null); }}>
                        <div className="cs-radio" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div></div>
              <button className="btn-p" onClick={handleMonthSearch}>Calculate</button>
              <button className="btn-g" onClick={handleClearMonth}>Clear</button>
            </div>
            {monthOptions.length >= 2 ? (
              <div id="monthChartWrap" className={`mt16${monthOptions.length < 2 ? ' hidden' : ''}`}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 14 }}>
                  Monthly Wtd Avg DPO Trend
                </div>
                <div style={{ position: 'relative', height: 200, width: '100%' }}>
                  <canvas id="dpoLineChart" ref={chartRef} />
                </div>
              </div>
            ) : null}
            {monthResult ? (
              <div className="dpo-result" style={{ display: 'block' }}>
                <div className="big">{monthResult.wd.toFixed(1)}</div>
                <div className="lbl">Weighted Avg DPO · {monthResult.buyer || 'All Buyers'}{monthResult.month ? ` - ${monthResult.month}` : ''}</div>
                <div className="det" style={{ marginTop: 8, fontSize: 12, color: 'var(--surface)' }}>{monthResult.rows.length} PO lines · Simple Avg: {monthResult.avg.toFixed(1)}d · Total: {fmtFull(monthResult.tot)}</div>
              </div>
            ) : null}
            {monthDetailRows.length ? (
              <div id="monthDetail" className="mt16"><div className="tbl-wrap"><table><thead><tr><th>PO No.</th><th>BU</th><th>Product</th><th>Supplier</th><th>Amount (INR)</th><th>DPO</th><th>PO Date</th></tr></thead><tbody>
                {monthDetailRows.map((r, idx) => (
                  <tr key={`${r['PO no.']}-${idx}`}>
                    <td>{r['PO no.']}</td>
                    <td><span className="pill p-t">{r.BU}</span></td>
                    <td style={{ maxWidth: 160, fontSize: 12 }}>{r.Product}</td>
                    <td style={{ fontSize: 12 }}>{r.Supplier}</td>
                    <td className="tr">{fmtFull(r['Amount in INR'])}</td>
                    <td>{dpoPill(r.DPO)}</td>
                    <td>{r.PO_date_str}</td>
                  </tr>
                ))}
              </tbody></table></div></div>
            ) : null}
          </div>
        </section>

        <section className="card">
          <div className="card-hdr"><div className="card-icon">🌿</div><div><div className="card-title">Spend Concentration Map</div><div className="card-sub">Total Spend → Domestic / Import → Top ~80% Suppliers</div></div></div>
          <div className="card-body">
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <div className="tree-node root-node" onClick={() => setTreeOpen(prev => ({ ...prev, level1: !prev.level1 }))}>
                <div className="tree-node-label">Total PO Value</div>
                <div className="tree-node-val">{fmtFull(sumF(selectedData, 'Amount in INR'))}</div>
                <div className="tree-node-sub">Click to expand</div>
              </div>
            </div>
            {treeOpen.level1 ? (
              <>
                <div className="tree-connector" />
                <div className="tree-row">
                  <div className="tree-node" style={{ minWidth: 220 }} onClick={() => setTreeOpen(prev => ({ ...prev, dom: !prev.dom }))}>
                    <div className="tree-badge-dom">🏠 Domestic</div>
                    <div className="tree-node-val">{fmtFull(sumF(selectedData.filter(isDom), 'Amount in INR'))}</div>
                    <div className="tree-node-sub">{`${((sumF(selectedData.filter(isDom), 'Amount in INR') / (sumF(selectedData, 'Amount in INR') || 1)) * 100).toFixed(1)}% of total - ${new Set(selectedData.filter(isDom).map(r => r.Supplier)).size} suppliers`}</div>
                    <div className="tree-node-hint">Click for top suppliers</div>
                  </div>
                  <div className="tree-node" style={{ minWidth: 220 }} onClick={() => setTreeOpen(prev => ({ ...prev, imp: !prev.imp }))}>
                    <div className="tree-badge-imp">🌍 Import</div>
                    <div className="tree-node-val">{fmtFull(sumF(selectedData.filter(isImp), 'Amount in INR'))}</div>
                    <div className="tree-node-sub">{`${((sumF(selectedData.filter(isImp), 'Amount in INR') / (sumF(selectedData, 'Amount in INR') || 1)) * 100).toFixed(1)}% of total - ${new Set(selectedData.filter(isImp).map(r => r.Supplier)).size} suppliers`}</div>
                    <div className="tree-node-hint">Click for top suppliers</div>
                  </div>
                </div>
                {treeOpen.dom ? (
                  <div>
                    <div className="tree-connector" />
                    <div className="tree-leaf-box">
                      <div className="tree-leaf-hdr"><span>🏠 Domestic — Top ~80% Suppliers</span><span id="treeDomWdpo" style={{ fontSize: 12, color: 'var(--c1)', fontWeight: 700 }}>{/* computed later */}</span></div>
                      <div id="treeDomAlert" style={{ marginBottom: 10 }} />
                      <div className="tbl-wrap"><table><thead><tr><th>Rank</th><th>Supplier</th><th>PO Value (INR)</th><th>PO Count</th><th>% Spend</th><th>Cum %</th><th>Wtd DPO</th></tr></thead><tbody>
                        {paretoRows(selectedData.filter(isDom)).top80.map(row => (
                          <tr key={`dom-${row.supplier}`}>
                            <td>{row.rank}</td>
                            <td style={{ maxWidth: 200, wordBreak: 'break-word', fontSize: 12 }}>{row.supplier}</td>
                            <td className="tr">{fmtFull(row.value)}</td>
                            <td className="tr">{row.count}</td>
                            <td><div className="pbar-wrap"><div className="pbar-track"><div className="pbar-fill" style={{ width: `${Math.min(row.pct * 4, 100)}%` }} /></div><div className="pbar-pct">{row.pct.toFixed(1)}%</div></div></td>
                            <td>{row.cum.toFixed(1)}%</td>
                            <td>{dpoPill(Math.round(row.wdpo))}</td>
                          </tr>
                        ))}
                      </tbody></table></div>
                    </div>
                  </div>
                ) : null}
                {treeOpen.imp ? (
                  <div>
                    <div className="tree-connector" />
                    <div className="tree-leaf-box">
                      <div className="tree-leaf-hdr"><span>🌍 Import — Top ~80% Suppliers</span><span id="treeImpWdpo" style={{ fontSize: 12, color: 'var(--c1)', fontWeight: 700 }}>{/* computed later */}</span></div>
                      <div id="treeImpAlert" style={{ marginBottom: 10 }} />
                      <div className="tbl-wrap"><table><thead><tr><th>Rank</th><th>Supplier</th><th>PO Value (INR)</th><th>PO Count</th><th>% Spend</th><th>Cum %</th><th>Wtd DPO</th></tr></thead><tbody>
                        {paretoRows(selectedData.filter(isImp)).top80.map(row => (
                          <tr key={`imp-${row.supplier}`}>
                            <td>{row.rank}</td>
                            <td style={{ maxWidth: 200, wordBreak: 'break-word', fontSize: 12 }}>{row.supplier}</td>
                            <td className="tr">{fmtFull(row.value)}</td>
                            <td className="tr">{row.count}</td>
                            <td><div className="pbar-wrap"><div className="pbar-track"><div className="pbar-fill" style={{ width: `${Math.min(row.pct * 4, 100)}%` }} /></div><div className="pbar-pct">{row.pct.toFixed(1)}%</div></div></td>
                            <td>{row.cum.toFixed(1)}%</td>
                            <td>{dpoPill(Math.round(row.wdpo))}</td>
                          </tr>
                        ))}
                      </tbody></table></div>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        {showDpoCard ? (
          <section className="card" id="dpoImproveCard">
            <div className="card-hdr">
              <div className="card-icon" style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)' }}>🎯</div>
              <div style={{ flex: 1 }}>
                <div className="card-title">DPO Improvement Tracker</div>
                <div className="card-sub">Current DPO vs Targeted DPO (EOY) — live from your improvement sheet</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span id="dpoImpStatus" style={{ fontSize: 11, color: 'var(--text3)' }}>{dpoImpStatus}</span>
                <button className="btn-g" style={{ fontSize: 11, padding: '6px 12px' }} onClick={loadDPOImprove}>↻ Refresh</button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, padding: '16px 22px', borderBottom: '1px solid var(--border)' }}>
              <div className="meta"><div className="meta-lbl">Suppliers Tracked</div><div className="meta-val">{dpoImpSummary ? dpoImpSummary.count : '—'}</div></div>
              <div className="meta"><div className="meta-lbl">Avg Current DPO</div><div className="meta-val">{dpoImpSummary ? `${dpoImpSummary.avgCur}d` : '—'}</div></div>
              <div className="meta"><div className="meta-lbl">Avg Target DPO</div><div className="meta-val" style={{ color: '#03c5ae' }}>{dpoImpSummary ? `${dpoImpSummary.avgTgt}d` : '—'}</div></div>
              <div className="meta"><div className="meta-lbl">Avg DPO to Improve</div><div className="meta-val" style={{ color: '#d97706' }}>{dpoImpSummary ? `${dpoImpSummary.gap}d avg needed` : '—'}</div></div>
              <div className="meta"><div className="meta-lbl">✓ Target Achieved</div><div className="meta-val" style={{ color: '#03c5ae' }}>{dpoImpSummary ? `${dpoImpSummary.achieved}` : '—'}</div></div>
              <div className="meta"><div className="meta-lbl">△ Pending Improvement</div><div className="meta-val" style={{ color: '#d97706' }}>{dpoImpSummary ? `${dpoImpSummary.pending}` : '—'}</div></div>
            </div>
            <div className="card-body" style={{ overflow: 'visible' }}>
              <div className="filter-row" style={{ marginBottom: 16 }}>
                <div className="fld" style={{ minWidth: 180 }}><div className="fld-lbl">Filter by POC</div><div className="cs-wrap" onClick={e => e.stopPropagation()}>
                  <button className={`cs-btn${openDropdown === 'dimPoc' ? ' open' : ''}`} onClick={() => setOpenDropdown(openDropdown === 'dimPoc' ? null : 'dimPoc')}>
                    <span className="cs-val">{dimSelPoc || 'All POCs'}</span>
                    <span className="cs-arr">▼</span>
                  </button>
                  <div className={`cs-panel${openDropdown === 'dimPoc' ? ' show' : ''}`}>
                    <div className="cs-list">
                      <div className={`cs-item${!dimSelPoc ? ' sel' : ''}`} onClick={() => { setDimSelPoc(null); setOpenDropdown(null); }}><div className="cs-radio" /><span>All POCs</span></div>
                      {uniq(dpoImpData, 'POC').map(item => (
                        <div key={item} className={`cs-item${dimSelPoc === item ? ' sel' : ''}`} onClick={() => { setDimSelPoc(item); setOpenDropdown(null); }}><div className="cs-radio" /><span>{item}</span></div>
                      ))}
                    </div>
                  </div>
                </div></div>
                <div className="fld" style={{ minWidth: 180 }}><div className="fld-lbl">Filter by Country</div><div className="cs-wrap" onClick={e => e.stopPropagation()}>
                  <button className={`cs-btn${openDropdown === 'dimCnt' ? ' open' : ''}`} onClick={() => setOpenDropdown(openDropdown === 'dimCnt' ? null : 'dimCnt')}>
                    <span className="cs-val">{dimSelCnt || 'All Countries'}</span>
                    <span className="cs-arr">▼</span>
                  </button>
                  <div className={`cs-panel${openDropdown === 'dimCnt' ? ' show' : ''}`}>
                    <div className="cs-list">
                      <div className={`cs-item${!dimSelCnt ? ' sel' : ''}`} onClick={() => { setDimSelCnt(null); setOpenDropdown(null); }}><div className="cs-radio" /><span>All Countries</span></div>
                      {uniq(dpoImpData, 'Country').map(item => (
                        <div key={item} className={`cs-item${dimSelCnt === item ? ' sel' : ''}`} onClick={() => { setDimSelCnt(item); setOpenDropdown(null); }}><div className="cs-radio" /><span>{item}</span></div>
                      ))}
                    </div>
                  </div>
                </div></div>
                <button className="btn-g" onClick={() => { setDimSelPoc(null); setDimSelCnt(null); }}>Clear</button>
              </div>
              <div className="tbl-wrap"><table><thead><tr><th>#</th><th>Supplier</th><th>Product</th><th>Country</th><th>POC</th><th style={{ textAlign: 'center' }}>Current DPO</th><th style={{ textAlign: 'center' }}>Target DPO (EOY)</th><th style={{ minWidth: 200 }}>Progress towards Target</th></tr></thead><tbody>
                {filteredDpoImpRows.length ? filteredDpoImpRows.map((r, idx) => {
                  const gap = r.TargetDPO - r.CurrentDPO;
                  const achieved = gap <= 0;
                  const pct = r.TargetDPO > 0 ? Math.min(100, Math.round((r.CurrentDPO / r.TargetDPO) * 100)) : 100;
                  const barColor = achieved ? '#03c5ae' : pct >= 60 ? '#3b82f6' : '#f59e0b';
                  const domImp = (r.Country || '').toLowerCase() === 'india';
                  return (
                    <tr key={`${r.Supplier}-${idx}`}>
                      <td>{idx + 1}</td>
                      <td style={{ fontSize: 12, maxWidth: 160, wordBreak: 'break-word' }}>
                        <button style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--c1)', cursor: 'pointer', textDecoration: 'underline dotted', fontWeight: 600 }} onClick={() => setShowDpoModal(true)}>
                          {r.Supplier}
                        </button>
                      </td>
                      <td style={{ fontSize: 12, maxWidth: 140, wordBreak: 'break-word' }}>{r.Product || '—'}</td>
                      <td><span className={`pill ${domImp ? 'p-t' : 'p-b'}`}>{r.Country || '—'}</span></td>
                      <td style={{ fontSize: 12 }}>{r.POC || '—'}</td>
                      <td style={{ textAlign: 'center' }}><strong>{r.CurrentDPO}</strong><span style={{ fontSize: 11, color: 'var(--text3)' }}>d</span></td>
                      <td style={{ textAlign: 'center', color: '#03c5ae', fontWeight: 700 }}>{r.TargetDPO}<span style={{ fontSize: 11, color: 'var(--text3)' }}>d</span></td>
                      <td style={{ minWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 4 }} />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{pct}%</span>
                        </div>
                        <div style={{ fontSize: 10, marginTop: 2 }}>{achieved ? <span style={{ color: '#03c5ae', fontWeight: 700 }}>✓ Achieved</span> : <span style={{ color: '#d97706', fontWeight: 700 }}>+{gap}d needed</span>}</div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>No data for selected filters</td></tr>
                )}
              </tbody></table></div>
            </div>
          </section>
        ) : null}
      </main>

      {showDpoModal ? (
        <div className="overlay show" onClick={showModalOverlay(setShowDpoModal)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowDpoModal(false)}>×</button>
            <h2>Weighted Average DPO — Calculation Breakdown</h2>
            <p className="sub">Full formula and POC-level contribution</p>
            <div>
              <div className="calc-block">
                <h4>Formula</h4>
                <div className="formula">Weighted Avg DPO = Σ(Amount × DPO) ÷ Σ(Amount)</div>
              </div>
              <div className="calc-block">
                <h4>By Buyer (POC)</h4>
                {uniq(selectedData, 'POC').map(p => {
                  const rows = selectedData.filter(x => x.POC === p);
                  const a = sumF(rows, 'Amount in INR');
                  const wd = a > 0 ? rows.reduce((s, x) => s + x['Amount in INR'] * x.DPO, 0) / a : 0;
                  return (
                    <div key={p} className="calc-row"><span><strong>{p}</strong></span><span>{fmt(a)} · {wd.toFixed(1)}d · {(a / sumF(selectedData, 'Amount in INR') * 100).toFixed(1)}%</span></div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showSegModal ? (
        <div className="overlay show" onClick={showModalOverlay(setShowSegModal)}>
          <div className="modal" style={{ maxWidth: 820 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowSegModal(false)}>×</button>
            <h2>{segType} - Supplier 80/20 Analysis</h2>
            <p className="sub">Full supplier segmentation and spend break‑down</p>
            <div className="meta-row" style={{ marginBottom: 16 }}>
              <div className="meta"><div className="meta-lbl">Total Spend</div><div className="meta-val lg">{fmtFull(sumF(selectedData.filter(segType === 'Import' ? isImp : isDom), 'Amount in INR'))}</div></div>
              <div className="meta"><div className="meta-lbl">Top 80% Suppliers</div><div className="meta-val">{segmentRows.top80.length}</div></div>
              <div className="meta"><div className="meta-lbl">Wtd DPO Top 80%</div><div className="meta-val">{segmentWd.toFixed(1)}d</div></div>
            </div>
            <div className="seg-tabs tabs">
              <button className={`tab${segTab === '80' ? ' active' : ''}`} onClick={() => setSegTab('80')}>★ Top 80%</button>
              <button className={`tab${segTab === '20' ? ' active' : ''}`} onClick={() => setSegTab('20')}>Long Tail 20%</button>
            </div>
            <div style={{ display: segTab === '80' ? 'block' : 'none' }}>
              <div className="meta-row" style={{ marginBottom: 16 }}>
                <div className="meta"><div className="meta-lbl">Suppliers</div><div className="meta-val">{segmentRows.top80.length}</div></div>
                <div className="meta"><div className="meta-lbl">Spend</div><div className="meta-val lg">{fmtFull(segmentTotal)}</div></div>
                <div className="meta"><div className="meta-lbl">Wtd DPO</div><div className="meta-val">{segmentWd.toFixed(1)}d</div></div>
              </div>
              <div className="tbl-wrap"><table><thead><tr><th>Rank</th><th>Supplier</th><th>PO Value (INR)</th><th>PO Count</th><th>% Spend</th><th>Cum %</th><th>Wtd DPO</th></tr></thead><tbody>
                {segmentRows.top80.map(row => (
                  <tr key={row.supplier}><td>{row.rank}</td><td style={{ maxWidth: 220, wordBreak: 'break-word', fontSize: 12 }}>{row.supplier}</td><td className="tr">{fmtFull(row.value)}</td><td className="tr">{row.count}</td><td><div className="pbar-wrap"><div className="pbar-track"><div className="pbar-fill" style={{ width: `${Math.min(row.pct * 4, 100)}%` }} /></div><div className="pbar-pct">{row.pct.toFixed(1)}%</div></div></td><td>{row.cum.toFixed(1)}%</td><td>{dpoPill(Math.round(row.wdpo))}</td></tr>
                ))}
              </tbody></table></div>
            </div>
            <div style={{ display: segTab === '20' ? 'block' : 'none' }}>
              <div className="meta-row" style={{ marginBottom: 16 }}>
                <div className="meta"><div className="meta-lbl">Suppliers</div><div className="meta-val">{segmentRows.bot20.length}</div></div>
                <div className="meta"><div className="meta-lbl">Spend</div><div className="meta-val lg">{fmtFull(segmentRows.bot20.reduce((s, item) => s + item.value, 0))}</div></div>
                <div className="meta"><div className="meta-lbl">Wtd DPO</div><div className="meta-val">{(segmentRows.bot20.reduce((s, item) => s + item.value * item.wdpo, 0) / Math.max(segmentRows.bot20.reduce((s, item) => s + item.value, 0), 1)).toFixed(1)}d</div></div>
              </div>
              <div className="tbl-wrap"><table><thead><tr><th>Rank</th><th>Supplier</th><th>PO Value (INR)</th><th>PO Count</th><th>% Spend</th><th>Cum %</th><th>Wtd DPO</th></tr></thead><tbody>
                {segmentRows.bot20.map(row => (
                  <tr key={row.supplier}><td>{row.rank}</td><td style={{ maxWidth: 220, wordBreak: 'break-word', fontSize: 12 }}>{row.supplier}</td><td className="tr">{fmtFull(row.value)}</td><td className="tr">{row.count}</td><td><div className="pbar-wrap"><div className="pbar-track"><div className="pbar-fill" style={{ width: `${Math.min(row.pct * 4, 100)}%` }} /></div><div className="pbar-pct">{row.pct.toFixed(1)}%</div></div></td><td>{row.cum.toFixed(1)}%</td><td>{dpoPill(Math.round(row.wdpo))}</td></tr>
                ))}
              </tbody></table></div>
            </div>
          </div>
        </div>
      ) : null}

      {showTotalPOModal ? (
        <div className="overlay show" onClick={showModalOverlay(setShowTotalPOModal)}>
          <div className="modal" style={{ maxWidth: 860 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowTotalPOModal(false)}>×</button>
            <h2>Total PO Value — Import vs Domestic</h2>
            <p className="sub">Full spend bifurcation with 80/20 Pareto analysis</p>
            <div className="tabs" style={{ marginTop: 8 }}>
              <button className={`tab imp${tpoTab === 'imp' ? ' active' : ''}`} onClick={() => setTpoTab('imp')}>🌍 Import</button>
              <button className={`tab dom${tpoTab === 'dom' ? ' active' : ''}`} onClick={() => setTpoTab('dom')}>🏠 Domestic</button>
            </div>

            {currentTpoConc.total > 0 && currentTpoConc.pct <= 10 ? (
              <div style={{ marginTop: 12, marginBottom: 12, background: '#fff2f2', border: '1px solid #f5c6cb', color: '#8a1f1f', padding: '12px 14px', borderRadius: 8, fontWeight: 700 }}>
                ⚠ High concentration risk - {currentTpoConc.top} of {currentTpoConc.total} suppliers ({currentTpoConc.pct}%) account for this segment.
              </div>
            ) : null}

            <div className="meta-row" style={{ marginBottom: 16 }}>
              <div className="meta"><div className="meta-lbl">Total Spend</div><div className="meta-val">{fmtFull(sumF(tpoTab === 'imp' ? tpoRows.imp : tpoRows.dom, 'Amount in INR'))}</div></div>
              <div className="meta"><div className="meta-lbl">Suppliers</div><div className="meta-val">{(tpoTab === 'imp' ? tpoData.imp.totalSupp : tpoData.dom.totalSupp)}</div></div>
              <div className="meta"><div className="meta-lbl">Top ~80%</div><div className="meta-val">{(tpoTab === 'imp' ? tpoData.imp.top80.length : tpoData.dom.top80.length)} ({(tpoTab === 'imp' ? tpoConcentration.imp.pct : tpoConcentration.dom.pct)}%)</div></div>
              <div className="meta"><div className="meta-lbl">Wtd DPO</div><div className="meta-val">{(tpoTab === 'imp' ? wDpo(tpoRows.imp) : wDpo(tpoRows.dom)).toFixed(1)}d</div></div>
            </div>
            <div style={{ display: tpoTab === 'imp' ? 'block' : 'none' }}>
              <div className="tbl-wrap"><table><thead><tr><th>Rank</th><th>Supplier</th><th>PO Value (INR)</th><th>PO Count</th><th>% Spend</th><th>Cum %</th><th>Category</th></tr></thead><tbody>
                {[...tpoData.imp.top80, ...tpoData.imp.bot20].map(row => (
                  <tr key={`imp-${row.supplier}`}><td>{row.rank}</td><td style={{ maxWidth: 220, wordBreak: 'break-word', fontSize: 12 }}>{row.supplier}</td><td className="tr">{fmtFull(row.value)}</td><td className="tr">{row.count}</td><td><div className="pbar-wrap"><div className="pbar-track"><div className="pbar-fill" style={{ width: `${Math.min(row.pct * 4, 100)}%` }} /></div><div className="pbar-pct">{row.pct.toFixed(1)}%</div></div></td><td>{row.cum.toFixed(1)}%</td><td><span className={`pill ${row.top ? 'p-top' : 'p-tail'}`}>{row.top ? '★ Top 80%' : 'Long Tail'}</span></td></tr>
                ))}
              </tbody></table></div>
            </div>
            <div style={{ display: tpoTab === 'dom' ? 'block' : 'none' }}>
              <div className="tbl-wrap"><table><thead><tr><th>Rank</th><th>Supplier</th><th>PO Value (INR)</th><th>PO Count</th><th>% Spend</th><th>Cum %</th><th>Category</th></tr></thead><tbody>
                {[...tpoData.dom.top80, ...tpoData.dom.bot20].map(row => (
                  <tr key={`dom-${row.supplier}`}><td>{row.rank}</td><td style={{ maxWidth: 220, wordBreak: 'break-word', fontSize: 12 }}>{row.supplier}</td><td className="tr">{fmtFull(row.value)}</td><td className="tr">{row.count}</td><td><div className="pbar-wrap"><div className="pbar-track"><div className="pbar-fill" style={{ width: `${Math.min(row.pct * 4, 100)}%` }} /></div><div className="pbar-pct">{row.pct.toFixed(1)}%</div></div></td><td>{row.cum.toFixed(1)}%</td><td><span className={`pill ${row.top ? 'p-top' : 'p-tail'}`}>{row.top ? '★ Top 80%' : 'Long Tail'}</span></td></tr>
                ))}
              </tbody></table></div>
            </div>
          </div>
        </div>
      ) : null}

      {showSuppModal ? (
        <div className="overlay show" onClick={showModalOverlay(setShowSuppModal)}>
          <div className="modal" style={{ maxWidth: 820 }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowSuppModal(false)}>×</button>
            <h2>Unique Supplier Analysis</h2>
            <p className="sub">Explore supplier coverage by FY and segment</p>
            <div className="meta-row" style={{ marginBottom: 16 }}>
              <div className="meta"><div className="meta-lbl">Total Unique</div><div className="meta-val">{supplierModalData.allSet.size}</div></div>
              <div className="meta"><div className="meta-lbl">Domestic Only</div><div className="meta-val">{[...supplierModalData.domSet].filter(s => !supplierModalData.impSet.has(s)).length}</div></div>
              <div className="meta"><div className="meta-lbl">Import Only</div><div className="meta-val">{[...supplierModalData.impSet].filter(s => !supplierModalData.domSet.has(s)).length}</div></div>
              <div className="meta"><div className="meta-lbl">+ New ({supplierModalData.curFy})</div><div className="meta-val" style={{ color: '#03c5ae' }}>{supplierModalData.newSupp.length}</div></div>
              <div className="meta"><div className="meta-lbl">− Left</div><div className="meta-val" style={{ color: '#ef4444' }}>{supplierModalData.leftSupp.length}</div></div>
              <div className="meta"><div className="meta-lbl">↔ Existing</div><div className="meta-val">{supplierModalData.existSupp.length}</div></div>
            </div>
            <div className="seg-tabs tabs">
              <button className={`tab${suppTab === 'all' ? ' active' : ''}`} onClick={() => handleSelectSuppTab('all')}>All</button>
              <button className={`tab${suppTab === 'dom' ? ' active' : ''}`} onClick={() => handleSelectSuppTab('dom')}>Domestic</button>
              <button className={`tab imp${suppTab === 'imp' ? ' active' : ''}`} onClick={() => handleSelectSuppTab('imp')}>Import</button>
              <button className={`tab${suppTab === 'ovlp' ? ' active' : ''}`} onClick={() => handleSelectSuppTab('ovlp')}>Overlap</button>
              <button className={`tab${suppTab === 'new' ? ' active' : ''}`} onClick={() => handleSelectSuppTab('new')}>New</button>
              <button className={`tab exist${suppTab === 'exist' ? ' active' : ''}`} onClick={() => handleSelectSuppTab('exist')}>Existing</button>
              <button className={`tab${suppTab === 'left' ? ' active' : ''}`} onClick={() => handleSelectSuppTab('left')}>Left</button>
            </div>
            <div style={{ margin: '14px 0 0' }}>
              <input className="cs-search" style={{ width: '100%', boxSizing: 'border-box' }} value={suppSearch} onChange={e => setSuppSearch(e.target.value)} placeholder="Search suppliers..." />
            </div>
            <div className="tbl-wrap" style={{ marginTop: 14 }}><table><thead><tr><th>#</th><th>Supplier</th><th>Country</th><th>Segment</th><th>Status</th><th>PO Lines</th><th>Value (INR)</th><th>Wtd DPO</th></tr></thead><tbody>
              {filteredSuppRows.length ? filteredSuppRows.map((row, idx) => (
                <tr key={`${row.supplier}-${idx}`}>
                  <td>{idx + 1}</td>
                  <td style={{ maxWidth: 180, wordBreak: 'break-word', fontSize: 12, fontWeight: 600 }}>{row.supplier}</td>
                  <td style={{ fontSize: 12 }}>{row.countries}</td>
                  <td>{row.seg === 'Both' ? <span className="pill p-o">Both</span> : row.seg === 'Domestic' ? <span className="pill p-t">Domestic</span> : <span className="pill p-import">Import</span>}</td>
                  <td>{row.yStatus === 'New' ? <span className="pill p-g">+ New</span> : row.yStatus === 'Left' ? <span className="pill p-r">− Left</span> : row.yStatus === 'Existing' ? <span className="pill p-exist">↔ Existing</span> : <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>}</td>
                  <td className="tr">{row.lines}</td>
                  <td className="tr">{fmtFull(row.value)}</td>
                  <td>{dpoPill(Math.round(row.wdpo))}</td>
                </tr>
              )) : (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--text3)' }}>No suppliers found</td></tr>
              )}
            </tbody></table></div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ScimplifyDashboard;
