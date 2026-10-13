import ActiveJob from '../JobFlow.jsx'

// Renders the job screen for a job id directly (the Shift screen reaches it after a delivery).
export const ActiveJobForTest = ({ id }) => <ActiveJob jobId={id} onDelivered={() => {}} />
