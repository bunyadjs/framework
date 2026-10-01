import { expect, test } from "bun:test";
import {
  Dispatcher,
  Event,
  event,
  setEventDispatcher,
} from "../src/index.ts";

class UserRegistered extends Event {
  constructor(readonly email: string) {
    super();
  }
}

test("dispatch invokes listeners in order", async () => {
  const dispatcher = new Dispatcher();
  const log: string[] = [];

  dispatcher.listen(UserRegistered, (e) => {
    log.push(`a:${e.email}`);
  });
  dispatcher.listen(UserRegistered, async (e) => {
    log.push(`b:${e.email}`);
  });

  await dispatcher.dispatch(new UserRegistered("ada@example.com"));
  expect(log).toEqual(["a:ada@example.com", "b:ada@example.com"]);
});

test("listenOnce and string events", async () => {
  const dispatcher = new Dispatcher();
  setEventDispatcher(dispatcher);

  let count = 0;
  dispatcher.listenOnce(UserRegistered, () => {
    count += 1;
  });

  await event(new UserRegistered("a@b.c"));
  await event(new UserRegistered("a@b.c"));
  expect(count).toBe(1);

  const names: string[] = [];
  dispatcher.listen("order.placed", (payload) => {
    names.push(String((payload as { id: number }).id));
  });
  await dispatcher.dispatchAs("order.placed", { id: 9 });
  expect(names).toEqual(["9"]);
});

test("queued listeners go through queue pusher", async () => {
  const queued: object[] = [];
  const sync: string[] = [];

  const dispatcher = new Dispatcher({
    queue: async (listener, ev) => {
      queued.push(ev);
      await listener(ev);
    },
  });

  dispatcher.listen(UserRegistered, (e) => {
    sync.push(e.email);
  });
  dispatcher.listen(
    UserRegistered,
    (e) => {
      sync.push(`q:${e.email}`);
    },
    { queued: true },
  );

  await dispatcher.dispatch(new UserRegistered("ada@example.com"));
  expect(queued).toHaveLength(1);
  expect(sync).toEqual(["ada@example.com", "q:ada@example.com"]);
});

test("Event.fake records dispatches without running listeners", async () => {
  const dispatcher = new Dispatcher();
  setEventDispatcher(dispatcher);

  let ran = false;
  dispatcher.listen(UserRegistered, () => {
    ran = true;
  });

  const fake = Event.fake();
  await event(new UserRegistered("ada@example.com"));
  expect(ran).toBe(false);

  Event.assertDispatched(UserRegistered);
  Event.assertDispatched(UserRegistered, (e) => {
    return (e as UserRegistered).email === "ada@example.com";
  });
  Event.assertDispatchedTimes(UserRegistered, 1);
  Event.assertNotDispatched("order.placed");

  await fake.dispatchAs("order.placed", { id: 1 });
  Event.assertDispatched("order.placed");

  fake.restore();
  await event(new UserRegistered("bob@example.com"));
  expect(ran).toBe(true);
});

test("Event.dispatch mirrors event helper", async () => {
  const dispatcher = new Dispatcher();
  setEventDispatcher(dispatcher);
  const log: string[] = [];
  dispatcher.listen(UserRegistered, (e) => {
    log.push(e.email);
  });

  await Event.dispatch(new UserRegistered("ada@example.com"));
  expect(log).toEqual(["ada@example.com"]);
});

test("Event.subscribe registers listener map", async () => {
  const dispatcher = new Dispatcher();
  setEventDispatcher(dispatcher);
  const seen: string[] = [];

  class UserEventSubscriber {
    subscribe() {
      return {
        [UserRegistered.name]: "handle",
      };
    }

    handle(e: UserRegistered) {
      seen.push(e.email);
    }
  }

  // Class-event registration via array form
  class TypedSubscriber {
    subscribe() {
      return [[UserRegistered, "onRegister"]] as Array<
        [typeof UserRegistered, string]
      >;
    }

    onRegister(e: UserRegistered) {
      seen.push(`typed:${e.email}`);
    }
  }

  Event.subscribe(new TypedSubscriber());
  await event(new UserRegistered("ada@example.com"));
  expect(seen).toEqual(["typed:ada@example.com"]);

  dispatcher.flush();
  seen.length = 0;
  dispatcher.subscribe(UserEventSubscriber);
  // String map keys won't match class dispatch — use listen via subscribe callback:
  class CallbackSubscriber {
    subscribe(events: Dispatcher) {
      events.listen(UserRegistered, (e) => {
        seen.push(`cb:${e.email}`);
      });
    }
  }
  dispatcher.subscribe(CallbackSubscriber);
  await event(new UserRegistered("bob@example.com"));
  expect(seen).toEqual(["cb:bob@example.com"]);
});

test("until push defer wildcards and Event facade", async () => {
  const dispatcher = new Dispatcher();
  setEventDispatcher(dispatcher);

  dispatcher.listen(UserRegistered, () => "first");
  dispatcher.listen(UserRegistered, () => "second");
  expect(await dispatcher.until(new UserRegistered("a@b.c"))).toBe("first");

  const wild: string[] = [];
  dispatcher.listen("order.*", (p) => {
    wild.push(String((p as { id: number }).id));
  });
  await dispatcher.dispatchAs("order.placed", { id: 7 });
  expect(wild).toEqual(["7"]);
  expect(dispatcher.hasWildcardListeners("order.placed")).toBe(true);
  expect(dispatcher.getListeners("order.placed").length).toBeGreaterThan(0);
  expect(dispatcher.getWildcardListeners("order.placed").length).toBe(1);
  expect(dispatcher.getWildcardListeners().length).toBeGreaterThan(0);

  dispatcher.push("order.shipped", { id: 3 });
  const shipped: number[] = [];
  dispatcher.listen("order.shipped", (p) => {
    shipped.push((p as { id: number }).id);
  });
  await dispatcher.flush("order.shipped");
  expect(shipped).toEqual([3]);

  const deferred: string[] = [];
  dispatcher.listen(UserRegistered, (e) => {
    deferred.push(e.email);
  });
  await Event.defer(async () => {
    await event(new UserRegistered("defer@test"));
    expect(deferred).toEqual([]);
  });
  expect(deferred).toEqual(["defer@test"]);

  Event.listen(UserRegistered, () => {});
  Event.assertListening(UserRegistered);
  Event.forget(UserRegistered);
});

test("Event.flush(name) facade flushes pushed events", async () => {
  const dispatcher = new Dispatcher();
  setEventDispatcher(dispatcher);
  const ids: number[] = [];
  Event.listen("order.shipped", (p) => {
    ids.push((p as { id: number }).id);
  });
  Event.push("order.shipped", { id: 11 });
  Event.push("order.shipped", { id: 12 });
  Event.push("other", { id: 99 });
  await Event.flush("order.shipped");
  expect(ids).toEqual([11, 12]);
  Event.forgetPushed();
});

test("defer discards events when callback throws", async () => {
  const dispatcher = new Dispatcher();
  setEventDispatcher(dispatcher);
  const seen: string[] = [];
  dispatcher.listen(UserRegistered, (e) => {
    seen.push(e.email);
  });

  await expect(
    Event.defer(async () => {
      await event(new UserRegistered("lost@test"));
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(seen).toEqual([]);

  await Event.defer(async () => {
    await event(new UserRegistered("kept@test"));
  });
  expect(seen).toEqual(["kept@test"]);
});

test("Event.fake subset lets other events run on previous", async () => {
  const dispatcher = new Dispatcher();
  setEventDispatcher(dispatcher);
  const ran: string[] = [];
  dispatcher.listen(UserRegistered, (e) => {
    ran.push(e.email);
  });
  dispatcher.listen("order.placed", () => {
    ran.push("order");
  });

  const fake = Event.fake([UserRegistered]);
  await event(new UserRegistered("faked@test"));
  await fake.dispatchAs("order.placed", { id: 1 });
  expect(ran).toEqual(["order"]);
  Event.assertDispatched(UserRegistered);
  Event.assertNotDispatched("order.placed");
  fake.restore();
});

test("queued listener without queue pusher throws", async () => {
  const dispatcher = new Dispatcher();
  dispatcher.listen(UserRegistered, () => {}, { queued: true });
  await expect(
    dispatcher.dispatch(new UserRegistered("q@test")),
  ).rejects.toThrow(/Queued listener requires Dispatcher/);
});

test("Event.assertListening sees previous after fake", async () => {
  const dispatcher = new Dispatcher();
  setEventDispatcher(dispatcher);
  dispatcher.listen(UserRegistered, () => {});
  const fake = Event.fake();
  Event.assertListening(UserRegistered);
  fake.restore();
});

test("class listener handle is invoked", async () => {
  const seen: string[] = [];
  class SendWelcome {
    handle(e: UserRegistered) {
      seen.push(e.email);
    }
  }
  const dispatcher = new Dispatcher();
  dispatcher.listen(UserRegistered, SendWelcome);
  await dispatcher.dispatch(new UserRegistered("ada@test"));
  expect(seen).toEqual(["ada@test"]);
});

test("static handle class listener", async () => {
  const seen: string[] = [];
  class LogRegistration {
    static handle(e: UserRegistered) {
      seen.push(`static:${e.email}`);
    }
  }
  const dispatcher = new Dispatcher();
  dispatcher.listen(UserRegistered, LogRegistration);
  await dispatcher.dispatch(new UserRegistered("static@test"));
  expect(seen).toEqual(["static:static@test"]);
});

test("class listener uses makeListener factory", async () => {
  const seen: string[] = [];
  class SendWelcome {
    constructor(private readonly tag: string) {}
    handle(e: UserRegistered) {
      seen.push(`${this.tag}:${e.email}`);
    }
  }
  const dispatcher = new Dispatcher({
    makeListener: () => new SendWelcome("di"),
  });
  dispatcher.listen(UserRegistered, SendWelcome);
  await dispatcher.dispatch(new UserRegistered("bob@test"));
  expect(seen).toEqual(["di:bob@test"]);
});

test("afterCommit event waits for schedule hook", async () => {
  const ran: string[] = [];
  const pending: Array<() => void | Promise<void>> = [];
  class OrderPaid {
    static afterCommit = true;
    constructor(readonly id: number) {}
  }
  const dispatcher = new Dispatcher({
    afterCommit: (cb) => {
      pending.push(cb);
    },
  });
  dispatcher.listen(OrderPaid, (e) => {
    ran.push(String(e.id));
  });
  await dispatcher.dispatch(new OrderPaid(9));
  expect(ran).toEqual([]);
  expect(pending.length).toBe(1);
  await pending[0]!();
  expect(ran).toEqual(["9"]);
});

test("dispatch options afterCommit and ShouldDispatchAfterCommit", async () => {
  const { connectSqlite } = await import("@bunyad/database");
  const { ShouldDispatchAfterCommit } = await import("../src/index.ts");
  const connection = connectSqlite();
  const ran: string[] = [];

  class Paid extends ShouldDispatchAfterCommit {
    constructor(readonly id: number) {
      super();
    }
  }

  class Immediate {
    constructor(readonly id: number) {}
  }

  const dispatcher = new Dispatcher();
  setEventDispatcher(dispatcher);
  dispatcher.listen(Paid, (e) => {
    ran.push(`paid:${e.id}`);
  });
  dispatcher.listen(Immediate, (e) => {
    ran.push(`imm:${e.id}`);
  });

  await connection.transaction(async () => {
    await Event.dispatch(new Paid(1));
    await Event.dispatch(new Immediate(2), { afterCommit: true });
    expect(ran).toEqual([]);
  });
  await Bun.sleep(10);
  expect(ran).toEqual(["paid:1", "imm:2"]);

  ran.length = 0;
  await Event.dispatch(new Paid(3));
  await Bun.sleep(10);
  expect(ran).toEqual(["paid:3"]);

  await connection.close();
});
