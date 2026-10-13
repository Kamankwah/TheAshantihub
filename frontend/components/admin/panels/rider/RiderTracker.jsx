import { useEffect } from "react";
import { setPingSpeed, startTracking, stopTracking } from "../../../../lib/riderTracking.js";
import { useRiderMe } from "../../../../hooks/useDelivery.js";

// Mounted once in the staff shell for a Dispatch rider. It shares the rider's location with the
// server while a shift is open and the app is open, on any screen, and stops the moment the
// shift ends or the rider signs out. It draws nothing.
export default function RiderTracker() {
  const { data } = useRiderMe();
  const onShift = Boolean(data?.shift) && !data?.rider?.suspended;
  const onJob = Boolean(data?.active_job_id);
  useEffect(() => {
    if (onShift) startTracking({ onJob });
    else stopTracking();
  }, [onShift]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPingSpeed(onJob); }, [onJob]);
  useEffect(() => stopTracking, []);
  return null;
}
