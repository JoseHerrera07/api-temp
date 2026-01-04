const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PUERTO = 3001; 

app.use(cors());
app.use(express.static(path.join(__dirname))); 

// --- BASE DE DATOS (Tu archivo de memoria eterna) ---
const db = new sqlite3.Database('./historial.db', (err) => {
    if (err) console.error("Error DB:", err.message);
    else console.log("💾 Memoria lista: historial.db");
});

// Tabla unificada
db.run(`CREATE TABLE IF NOT EXISTS mediciones (
    fecha TEXT,
    hora TEXT,
    temp REAL,
    hum REAL,
    demanda_real REAL,
    demanda_prog REAL,
    PRIMARY KEY (fecha, hora)
)`);

const ID_EJECUTADA = 6;  
const ID_PROGRAMADA = 3; 

// --- HERRAMIENTAS DE TIEMPO ---
function obtenerFechaHoy() {
    const hoy = new Date();
    const yyyy = hoy.getFullYear();
    const mm = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd = String(hoy.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Convierte "h1" -> "00:00", "h2" -> "00:30"...
function keyHoraAFormatoVisual(hKey) {
    // h1 es 00:00, h2 es 00:30
    const numeroBloque = parseInt(hKey.replace('h', ''));
    const minutosTotales = (numeroBloque - 1) * 30;
    const horas = Math.floor(minutosTotales / 60);
    const mins = minutosTotales % 60;
    return `${horas.toString().padStart(2,'0')}:${mins.toString().padStart(2,'0')}`;
}

function obtenerHoraActual() {
    const ahora = new Date();
    const min = ahora.getMinutes() < 30 ? "00" : "30";
    return `${ahora.getHours().toString().padStart(2,'0')}:${min}`;
}

// --- LÓGICA COES MASIVA (EL CAMBIO IMPORTANTE) ---
async function descargarYGuardarDiaCompletoCOES() {
    const fecha = obtenerFechaHoy();
    
    // Función interna para traer los datos crudos
    const traerDatos = async (id) => {
        try {
            const url = `https://appserver.coes.org.pe/waMediciones/api/Mediciones?lectcodi=${id}&fechaIni=${fecha}&fechaFin=${fecha}`;
            const resp = await axios.get(url);
            return resp.data.listMediciones || resp.data || [];
        } catch (e) { return []; }
    };

    console.log("📥 Descargando historial del COES...");
    const [listaReal, listaProg] = await Promise.all([
        traerDatos(ID_EJECUTADA),
        traerDatos(ID_PROGRAMADA)
    ]);

    // Recorremos las 48 horas (h1 ... h48)
    for (let i = 1; i <= 48; i++) {
        const key = `h${i}`;
        const horaVisual = keyHoraAFormatoVisual(key);

        // Sumar todas las plantas para esta hora específica
        let sumaReal = 0;
        let sumaProg = 0;
        let hayDatosReal = false;

        if (Array.isArray(listaReal)) {
            listaReal.forEach(item => {
                if (item[key] !== null) {
                    sumaReal += parseFloat(item[key] || 0);
                    hayDatosReal = true;
                }
            });
        }

        if (Array.isArray(listaProg)) {
            listaProg.forEach(item => sumaProg += parseFloat(item[key] || 0));
        }

        // SOLO GUARDAMOS SI HAY DATOS (Para no llenar la DB de ceros del futuro)
        // La programada siempre se guarda porque es una predicción futura
        if (hayDatosReal || sumaProg > 0) {
            // TRUCO: Usamos COALESCE para no borrar la temperatura si ya estaba guardada
            // Si temp es NULL, mantén el valor viejo.
            const sql = `
                INSERT INTO mediciones (fecha, hora, demanda_real, demanda_prog, temp, hum) 
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(fecha, hora) DO UPDATE SET
                demanda_real = excluded.demanda_real,
                demanda_prog = excluded.demanda_prog
            `;
            
            // Nota: Para temp/hum ponemos null aquí porque el COES no sabe de clima.
            // La base de datos mantendrá el clima si ya existía gracias al UPDATE selectivo.
            db.run(sql, [fecha, horaVisual, sumaReal, sumaProg, null, null], (err) => {
                if (err) console.error("Error guardando COES:", err.message);
            });
        }
    }
    console.log("✅ Historial COES sincronizado en DB.");
}

// --- LÓGICA CLIMA (EN VIVO) ---
async function guardarClimaActual() {
    const fecha = obtenerFechaHoy();
    const hora = obtenerHoraActual();

    try {
        const url = "https://api.open-meteo.com/v1/forecast?latitude=-12.0464&longitude=-77.0428&current=temperature_2m,relative_humidity_2m&timezone=auto";
        const resp = await axios.get(url);
        const temp = resp.data.current.temperature_2m;
        const hum = resp.data.current.relative_humidity_2m;

        // Aquí al revés: Actualizamos clima, no tocamos COES
        const sql = `
            INSERT INTO mediciones (fecha, hora, temp, hum, demanda_real, demanda_prog) 
            VALUES (?, ?, ?, ?, 0, 0)
            ON CONFLICT(fecha, hora) DO UPDATE SET
            temp = excluded.temp,
            hum = excluded.hum
        `;
        
        db.run(sql, [fecha, hora, temp, hum]);
        console.log(`🌤️ Clima guardado: ${hora} -> ${temp}°C`);
    } catch (e) { console.error("Error Clima"); }
}


// --- RUTAS ---

// 1. Sincronizar: Se llama desde el frontend cada 5 min
app.get('/api/sincronizar', async (req, res) => {
    // Disparamos las descargas (sin esperar a que terminen para responder rápido)
    await guardarClimaActual();
    await descargarYGuardarDiaCompletoCOES();

    const fecha = obtenerFechaHoy();
    
    // Leemos la DB y la enviamos al frontend
    db.all(`SELECT * FROM mediciones WHERE fecha = ? ORDER BY hora ASC`, [fecha], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Limpiamos los nulls de la DB para que el JSON vaya limpio
        const datosLimpios = rows.map(r => ({
            hora: r.hora,
            temp: r.temp,            // Si es null, el frontend lo manejará
            hum: r.hum,
            demanda_real: r.demanda_real,
            demanda_prog: r.demanda_prog
        }));

        res.json({ ok: true, datos: datosLimpios });
    });
});

// 2. Ruta para ver historial pasado (para cuando pongas los botones de fechas)
app.get('/api/historial/:fecha', (req, res) => {
    const fecha = req.params.fecha; // formato YYYY-MM-DD
    db.all(`SELECT * FROM mediciones WHERE fecha = ? ORDER BY hora ASC`, [fecha], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true, datos: rows });
    });
});

// Arrancar
app.listen(PUERTO, () => {
    console.log(`🚀 SERVIDOR LISTO: http://localhost:${PUERTO}`);
    // Al prender, hacemos una carga inicial inmediata
    descargarYGuardarDiaCompletoCOES();
    guardarClimaActual();
});