// Constantes
const VALORES_REFERENCIA = {
  FVC_MIN: 80,
  FEV1_MIN: 80,
  FEV1_FVC_MIN: 70
};

const TIPOS_PATRON = {
  NORMAL: 'Normal',
  OBSTRUCTIVO: 'Obstructivo',
  RESTRICTIVO: 'Restrictivo',
  MIXTO: 'Mixto'
};

// Componentes de utilidad
const Input = ({ label, value, onChange, ...props }) => (
  <div className="space-y-1">
    <label className="block text-sm text-gray-300">{label}</label>
    <input
      value={value}
      onChange={onChange}
      className="w-full p-2 bg-gray-700 rounded-md text-white focus:ring-2 focus:ring-blue-500"
      {...props}
    />
  </div>
);

const Select = ({ label, value, options, onChange }) => (
  <div className="space-y-1">
    <label className="block text-sm text-gray-300">{label}</label>
    <select
      value={value}
      onChange={onChange}
      className="w-full p-2 bg-gray-700 rounded-md text-white focus:ring-2 focus:ring-blue-500"
    >
      <option value="">Seleccione...</option>
      {options.map(opt => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  </div>
);

const Checkbox = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 p-3 bg-gray-700 rounded-md hover:bg-gray-600 cursor-pointer">
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="w-4 h-4 rounded accent-blue-500"
    />
    <span className="text-white">{label}</span>
  </label>
);

// Componente principal
const AsistenteEspirometrias = () => {
  const [paso, setPaso] = React.useState(1);
  const [datos, setDatos] = React.useState({
    paciente: {
      edad: '',
      sexo: '',
      altura: '',
      peso: ''
    },
    calidadTecnica: {
      inicioRapido: false,
      duracionMinima: false,
      meseta: false,
      sinArtefactos: false,
      reproducibilidad: false
    },
    mediciones: {
      fvc: '',
      fev1: '',
      relacion: '',
      fef2575: ''
    }
  });

  const actualizarDatos = (seccion, campo, valor) => {
    setDatos(prev => ({
      ...prev,
      [seccion]: {
        ...prev[seccion],
        [campo]: valor
      }
    }));
  };

  const validarCalidadTecnica = () => {
    const criteriosCumplidos = Object.values(datos.calidadTecnica).filter(Boolean).length;
    return criteriosCumplidos >= 4;
  };

  const obtenerDiagnostico = () => {
    const { fvc, fev1, relacion } = datos.mediciones;

    if (!fvc || !fev1 || !relacion) {
      return 'Faltan datos para realizar el diagnóstico';
    }

    const fvcPorcentaje = (fvc / VALORES_REFERENCIA.FVC_MIN) * 100;
    const fev1Porcentaje = (fev1 / VALORES_REFERENCIA.FEV1_MIN) * 100;
    const relacionNum = parseFloat(relacion);

    if (relacionNum >= VALORES_REFERENCIA.FEV1_FVC_MIN) {
      if (fvcPorcentaje >= 80 && fev1Porcentaje >= 80) {
        return TIPOS_PATRON.NORMAL;
      } else {
        return TIPOS_PATRON.RESTRICTIVO;
      }
    } else {
      if (fvcPorcentaje >= 80) {
        return TIPOS_PATRON.OBSTRUCTIVO;
      } else {
        return TIPOS_PATRON.MIXTO;
      }
    }
  };

  const pasos = [
    { num: 1, titulo: "Datos del Paciente" },
    { num: 2, titulo: "Calidad Técnica" },
    { num: 3, titulo: "Mediciones" },
    { num: 4, titulo: "Diagnóstico" }
  ];

  const renderPasoPaciente = () => (
    <div className="space-y-4">
      <h2 className="text-xl text-white font-bold">Datos del Paciente</h2>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Edad"
          type="number"
          value={datos.paciente.edad}
          onChange={e => actualizarDatos('paciente', 'edad', e.target.value)}
        />
        <Input
          label="Altura (cm)"
          type="number"
          value={datos.paciente.altura}
          onChange={e => actualizarDatos('paciente', 'altura', e.target.value)}
        />
        <Input
          label="Peso (kg)"
          type="number"
          value={datos.paciente.peso}
          onChange={e => actualizarDatos('paciente', 'peso', e.target.value)}
        />
        <Select
          label="Sexo"
          value={datos.paciente.sexo}
          options={['Hombre', 'Mujer']}
          onChange={e => actualizarDatos('paciente', 'sexo', e.target.value)}
        />
      </div>
    </div>
  );

  const renderPasoCalidad = () => (
    <div className="space-y-4">
      <h2 className="text-xl text-white font-bold">Calidad Técnica</h2>
      <div className="space-y-2">
        {[
          { id: 'inicioRapido', texto: "Inicio rápido y explosivo" },
          { id: 'duracionMinima', texto: "Duración mínima 6 segundos" },
          { id: 'meseta', texto: "Meseta en curva V/T" },
          { id: 'sinArtefactos', texto: "Sin artefactos" },
          { id: 'reproducibilidad', texto: "Reproducibilidad entre maniobras" }
        ].map(({ id, texto }) => (
          <Checkbox
            key={id}
            label={texto}
            checked={datos.calidadTecnica[id]}
            onChange={e => actualizarDatos('calidadTecnica', id, e.target.checked)}
          />
        ))}
      </div>
      {!validarCalidadTecnica() && (
        <div className="p-3 bg-red-900 rounded-md text-white">
          Se requieren al menos 4 criterios para considerar la prueba válida
        </div>
      )}
    </div>
  );

  const renderPasoMediciones = () => (
    <div className="space-y-4">
      <h2 className="text-xl text-white font-bold">Mediciones</h2>
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="FVC (L)"
          type="number"
          step="0.01"
          value={datos.mediciones.fvc}
          onChange={e => actualizarDatos('mediciones', 'fvc', e.target.value)}
        />
        <Input
          label="FEV1 (L)"
          type="number"
          step="0.01"
          value={datos.mediciones.fev1}
          onChange={e => actualizarDatos('mediciones', 'fev1', e.target.value)}
        />
        <Input
          label="FEV1/FVC (%)"
          type="number"
          step="0.1"
          value={datos.mediciones.relacion}
          onChange={e => actualizarDatos('mediciones', 'relacion', e.target.value)}
        />
        <Input
          label="FEF25-75 (L/s)"
          type="number"
          step="0.01"
          value={datos.mediciones.fef2575}
          onChange={e => actualizarDatos('mediciones', 'fef2575', e.target.value)}
        />
      </div>
    </div>
  );

  const renderPasoDiagnostico = () => {
    const diagnostico = obtenerDiagnostico();
    const colorFondo = {
      [TIPOS_PATRON.NORMAL]: 'bg-green-900',
      [TIPOS_PATRON.OBSTRUCTIVO]: 'bg-yellow-900',
      [TIPOS_PATRON.RESTRICTIVO]: 'bg-orange-900',
      [TIPOS_PATRON.MIXTO]: 'bg-red-900'
    }[diagnostico] || 'bg-gray-700';

    return (
      <div className="space-y-4">
        <h2 className="text-xl text-white font-bold">Diagnóstico</h2>
        <div className={`p-6 rounded-lg text-white ${colorFondo}`}>
          <h3 className="text-lg font-bold mb-2">Patrón {diagnostico}</h3>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="space-y-2">
              <div className="text-sm opacity-80">FVC</div>
              <div>{datos.mediciones.fvc} L</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm opacity-80">FEV1</div>
              <div>{datos.mediciones.fev1} L</div>
            </div>
            <div className="space-y-2">
              <div className="text-sm opacity-80">FEV1/FVC</div>
              <div>{datos.mediciones.relacion}%</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Navegación */}
      <div className="flex gap-2 p-4 bg-gray-800 rounded-lg">
        {pasos.map(({ num, titulo }) => (
          <button
            key={num}
            onClick={() => setPaso(num)}
            className={`px-4 py-2 rounded-md transition-colors
              ${paso === num ? 'bg-blue-600' : 'bg-gray-700'}
              hover:bg-blue-500`}
          >
            {titulo}
          </button>
        ))}
      </div>

      {/* Contenido */}
      <div className="p-6 bg-gray-800 rounded-lg">
        {paso === 1 && renderPasoPaciente()}
        {paso === 2 && renderPasoCalidad()}
        {paso === 3 && renderPasoMediciones()}
        {paso === 4 && renderPasoDiagnostico()}
      </div>
    </div>
  );
};

// Exportar el componente principal
export default AsistenteEspirometrias;