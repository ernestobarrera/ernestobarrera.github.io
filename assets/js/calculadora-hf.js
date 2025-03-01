// Componente para cada criterio individual
// Recibe: label (texto), checked (boolean), onChange (función), puntos (número)
const Criterio = ({ label, checked, onChange, puntos }) => (
  // El label envuelve todo para que sea clicable
  // Contenedor del criterio: padding(p-2), hover(hover:bg-gray-800), tamaño texto(text-base)

  <label className="flex items-center gap-3 cursor-pointer p-0 hover:bg-gray-800 rounded transition-colors text-base">
    <div className="flex items-center gap-3 flex-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-5 h-5 rounded bg-gray-900 border-gray-600"
      />
      <span className="text-gray-300">{label}</span>
    </div>
    <span className="text-blue-400 font-medium min-w-[1rem] text-right">+{puntos}</span>
  </label>
);

// Componente principal de la calculadora
const DiagnosticoHF = () => {
  // Estado para todos los criterios
  const [criterios, setCriterios] = React.useState({
    // Historia Familiar
    familiarEnfermedadPrecoz: false,
    familiarLDL: false,
    familiarXantomas: false,
    ninoLDL: false,
    // Historia Personal
    enfermedadCoronaria: false,
    enfermedadVascular: false,
    // Examen Físico
    xantomasTendinosos: false,
    arcoCorneal: false,
    // Analítica
    ldlNivel: '0',
    // Genética
    alteracionGen: false
  });

  // Calcula la puntuación total basada en los criterios seleccionados
  const calcularPuntuacion = () => {
    let puntos = 0;
    // Historia Familiar
    if (criterios.familiarEnfermedadPrecoz) puntos += 1;
    if (criterios.familiarLDL) puntos += 1;
    if (criterios.familiarXantomas) puntos += 2;
    if (criterios.ninoLDL) puntos += 2;
    // Historia Personal
    if (criterios.enfermedadCoronaria) puntos += 2;
    if (criterios.enfermedadVascular) puntos += 1;
    // Examen Físico
    if (criterios.xantomasTendinosos) puntos += 6;
    if (criterios.arcoCorneal) puntos += 4;
    // Nivel LDL
    switch (criterios.ldlNivel) {
      case '330': puntos += 8; break;
      case '250': puntos += 5; break;
      case '190': puntos += 3; break;
      case '155': puntos += 1; break;
      default: break;
    }
    // Genética
    if (criterios.alteracionGen) puntos += 8;
    return puntos;
  };

  // Determina el diagnóstico basado en la puntuación
  const getDiagnostico = (puntos) => {
    if (puntos >= 8) return 'Diagnóstico Cierto';
    if (puntos >= 6) return 'Diagnóstico Probable';
    return 'No concluyente';
  };

  const puntuacion = calcularPuntuacion();
  const diagnostico = getDiagnostico(puntuacion);

  return (
    <div className="w-full max-w-7xl mx-auto">
      {/* Grid principal de 3 columnas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* SECCIÓN 1: Historia Familiar */}
        <div className="bg-gray-900 p-4 rounded">
          <h3 className="flex items-center gap-2 text-blue-400 text-lg font-medium mb-3">
            <i className="fas fa-users"></i>
            Historia Familiar
          </h3>
          <div className="space-y-2">
            <Criterio
              label="Familiar 1º grado: coronaria/vascular precoz"
              checked={criterios.familiarEnfermedadPrecoz}
              onChange={(e) => setCriterios({ ...criterios, familiarEnfermedadPrecoz: e.target.checked })}
              puntos={1}
            />
            <Criterio
              label="Familiar 1º grado: C-LDL ≥ 210 mg/dl"
              checked={criterios.familiarLDL}
              onChange={(e) => setCriterios({ ...criterios, familiarLDL: e.target.checked })}
              puntos={1}
            />
            <Criterio
              label="Familiar 1º grado: Xantomas/Arco Corneal"
              checked={criterios.familiarXantomas}
              onChange={(e) => setCriterios({ ...criterios, familiarXantomas: e.target.checked })}
              puntos={2}
            />
            <Criterio
              label="Niño <18 años: C-LDL ≥ 150 mg/dl"
              checked={criterios.ninoLDL}
              onChange={(e) => setCriterios({ ...criterios, ninoLDL: e.target.checked })}
              puntos={2}
            />
          </div>
        </div>

        {/* SECCIÓN 2: Historia Personal */}
        <div className="bg-gray-900 p-4 rounded">
          <h3 className="flex items-center gap-2 text-blue-400 text-lg font-medium mb-3">
            <i className="fas fa-user-md"></i>
            Historia Personal y Examen Físico
          </h3>
          <div className="space-y-2">
            <Criterio
              label="Enfermedad coronaria precoz"
              checked={criterios.enfermedadCoronaria}
              onChange={(e) => setCriterios({ ...criterios, enfermedadCoronaria: e.target.checked })}
              puntos={2}
            />
            <Criterio
              label="Enfermedad vascular/cerebral precoz"
              checked={criterios.enfermedadVascular}
              onChange={(e) => setCriterios({ ...criterios, enfermedadVascular: e.target.checked })}
              puntos={1}
            />
            <Criterio
              label="Xantomas tendinosos"
              checked={criterios.xantomasTendinosos}
              onChange={(e) => setCriterios({ ...criterios, xantomasTendinosos: e.target.checked })}
              puntos={6}
            />
            <Criterio
              label="Arco corneal <45 años"
              checked={criterios.arcoCorneal}
              onChange={(e) => setCriterios({ ...criterios, arcoCorneal: e.target.checked })}
              puntos={4}
            />
          </div>
        </div>

        {/* SECCIÓN 3: Panel de Resultados */}
        <div className="space-y-3">
          {/* Niveles C-LDL */}
          <div className="bg-gray-900 p-4 rounded">
            <h3 className="flex items-center gap-2 text-blue-400 text-lg font-medium mb-3">
              <i className="fas fa-flask"></i>
              Niveles C-LDL
            </h3>
            <select
              className="w-full p-2 rounded bg-gray-800 text-gray-300 border border-gray-700 text-base"
              value={criterios.ldlNivel}
              onChange={(e) => setCriterios({ ...criterios, ldlNivel: e.target.value })}
            >
              <option value="0">Seleccione nivel</option>
              <option value="330">≥ 330 mg/dL (+8)</option>
              <option value="250">250-329 mg/dL (+5)</option>
              <option value="190">190-249 mg/dL (+3)</option>
              <option value="155">155-189 mg/dL (+1)</option>
            </select>

            {/* Genética */}
            <h3 className="flex items-center gap-2 text-blue-400 text-lg font-medium mt-4 mb-3">
              <i className="fas fa-dna"></i>
              Genética
            </h3>
            <Criterio
              label="Alteración gen r-LDL"
              checked={criterios.alteracionGen}
              onChange={(e) => setCriterios({ ...criterios, alteracionGen: e.target.checked })}
              puntos={8}
            />
          </div>

          {/* Panel de Resultado */}
          <div className="bg-gray-900 p-4 rounded">
            <h3 className="flex items-center gap-2 text-blue-400 text-lg font-medium mb-3">
              <i className="fas fa-calculator"></i>
              Resultado
            </h3>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-400">{puntuacion} puntos</div>
              <div className={`mt-2 text-base py-1 px-3 rounded-full inline-block ${puntuacion >= 8
                ? 'bg-green-900/30 text-red-400'  // Color diagnóstico cierto
                : puntuacion >= 6
                  ? 'bg-yellow-900/30 text-yellow-400'  // Color diagnóstico probable
                  : 'bg-gray-800 text-gray-300'  // Color no concluyente
                }`}>
                {diagnostico}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECCIÓN 4: Información y Notas */}
      <div className="mt-4 border-t border-gray-800 pt-3 text-sm space-y-2 text-gray-300">
        {/* Notas numeradas */}
        <div className="space-y-1">
          <div className="flex gap-2">
            <span className="text-blue-400">1.</span>
            <p>Se considera <span className="text-blue-400">familiar de primer grado</span> a: padre, madre, hermanos/as, hijos/as.</p>
          </div>
          <div className="flex gap-2">
            <span className="text-blue-400">2.</span>
            <p>La <span className="text-blue-400">enfermedad coronaria o vascular precoz</span> es aquella que ocurre antes de los 55 años en varones y antes de los 65 años en mujeres. Incluye: infarto, angina, angioplastia, revascularización, claudicación intermitente, enfermedad carotídea y aneurisma de aorta.</p>
          </div>
          <div className="flex gap-2">
            <span className="text-blue-400">3.</span>
            <p>Los <span className="text-blue-400">xantomas tendinosos</span> no incluyen los xantelasmas palpebrales.</p>
          </div>
          <div className="flex gap-2">
            <span className="text-blue-400">4.</span>
            <p>Las mediciones de <span className="text-blue-400">C-LDL</span> deben realizarse sin tratamiento farmacológico y tras descartar causas secundarias de hipercolesterolemia.</p>
          </div>
          <div className="flex gap-2">
            <span className="text-blue-400">5.</span>
            <p>Esta herramienta está basada en el <span className="text-blue-400">Programa Internacional MED-PED de la OMS</span> para el diagnóstico de Hipercolesterolemia Familiar Heterocigota.</p>
          </div>
        </div>

        {/* Pie de página */}
        <div className="text-sm border-t border-gray-800 pt-2 opacity-75">
          <p>
            <strong>Fuentes:</strong>
            <br />
            <a
              href="https://portal.guiasalud.es/wp-content/uploads/2018/12/GPC_567_Lipidos_Osteba_compl.pdf"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#f5be00' }}
            >
              1.- Guía de Práctica Clínica sobre el manejo de los lípidos como factor de riesgo cardiovascular. Ministerio de Sanidad. OSTEBA; 2017. Guías de Práctica Clínica en el SNS.
            </a>
            <br />
            2.- Ministerio de Transformación Digital y de la Función Pública. MUFACE. <i>Criterios diagnósticos de hipercolesterolemia familiar heterocigota (Programa internacional de la O.M.S, MED-PED)</i>.
          </p>

          <p className="mt-1 opacity-90">Esta herramienta está diseñada únicamente como ayuda al diagnóstico y no sustituye el juicio clínico profesional.</p>
        </div>
      </div>
    </div>
  );
};

// Inicialización de React
const rootElement = document.getElementById('root');
const root = ReactDOM.createRoot(rootElement);
root.render(React.createElement(DiagnosticoHF));


