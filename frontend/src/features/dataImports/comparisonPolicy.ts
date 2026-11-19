import type {MeasurementField} from './MeasurementCards';
const realPower=new Set(['total_real_power','phase_a_power','phase_b_power','phase_c_power']);
const realPowerUnits=new Set(['W','kW','MW']);
const knownUnits:Record<string,string[]>={reactive_power:['var','kvar','Mvar'],voltage:['V','kV'],current:['A','mA'],state_of_charge:['%','ratio'],energy_consumption:['Wh','kWh','MWh'],accumulated_ac_energy:['Wh','kWh','MWh'],energy_accumulated:['Wh','kWh','MWh'],apparent_power:['VA','kVA','MVA'],power_factor:['ratio','%'],frequency:['Hz','kHz']};
/** Equal units alone never establish comparable physical quantities. */
export function compatibleComparison(left:MeasurementField|undefined,right:MeasurementField):boolean{
  if(!left?.measurement_unit||!right.measurement_unit)return false;
  if(realPower.has(left.target_field)&&realPower.has(right.target_field))return realPowerUnits.has(left.measurement_unit)&&realPowerUnits.has(right.measurement_unit);
  // Keep interval/unknown consumption and each cumulative counter meaning separate.
  return left.target_field===right.target_field&&left.measurement_unit===right.measurement_unit&&Boolean(knownUnits[left.target_field]?.includes(left.measurement_unit));
}
