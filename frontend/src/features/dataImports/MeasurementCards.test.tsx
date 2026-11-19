import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {api} from '../../api/solaris';
import MeasurementCards from './MeasurementCards';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('shows only actual mapped measurements and latest plotted values without inventing totals',async()=>{
  vi.spyOn(api,'explorer').mockResolvedValue({chart:{unit:'kW',excluded_count:1,downsampled:true,points:[{source_row:2,plot_seconds:1,timestamp:'2026-09-01T00:00:00',value:3},{source_row:3,plot_seconds:2,value:null},{source_row:4,plot_seconds:3,timestamp:'2026-09-01T00:10:00',value:5}]}} as any);
  const select=vi.fn();render(<MeasurementCards workspaceId="w" dataset="d" version="v" fields={[{source_column:'power',target_field:'total_real_power',measurement_unit:'kW'}]} selected="power" onSelect={select}/>);
  const button=await screen.findByRole('button',{name:/Latest plotted: 2026-09-01T00:10:00/});fireEvent.click(button);expect(select).toHaveBeenCalledWith('power');
  expect(button.textContent).toContain('5');expect(button.querySelectorAll('polyline')).toHaveLength(2);
  expect(screen.queryByText(/irradiance/i)).toBeNull();expect(screen.getByText(/not averages or energy totals/)).toBeTruthy();
});
