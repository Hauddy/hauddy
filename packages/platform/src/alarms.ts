/** The one HubDO alarm is shared by email, mirroring, cleanup and attachments.
 * Never postpone another job, including when requests overlap across awaits.
 * During alarm(), getAlarm() is null until a new alarm has been scheduled. */
export async function scheduleAlarmBy(storage: DurableObjectStorage, deadline: number): Promise<void> {
  await storage.transaction(async (txn) => {
    const current = await txn.getAlarm();
    if (current === null || deadline < current) await txn.setAlarm(deadline);
  });
}
