---
title: Mocking
description: Swap facades for fakes — Event, Mail, Queue, Cache, Storage, and Notification.
---

# Mocking

## Introduction

When a feature dispatches jobs, sends mail, or writes files, tests usually should not hit the real driver. Bunyad packages expose `.fake()` helpers that record activity in memory so you can assert after the code under test runs.

There is no Mockery-style `$this->mock(Service::class)` on `TestCase`. Bind a hand-rolled stub with `app.instance(...)` when you need to replace a container service.

## Events

```ts
import { Event } from "@bunyad/events";
import UserRegistered from "@/Events/UserRegistered.ts";

const fake = Event.fake();

await this.postJson("/register", { /* … */ });

Event.assertDispatched(UserRegistered);
Event.assertDispatched(UserRegistered, (e) => e.user.email === "ada@example.com");
Event.assertDispatchedTimes(UserRegistered, 1);
Event.assertNothingDispatched(); // or assertNotDispatched(Type)

fake.restore();
```

Pass an allow-list to fake only some events; others still run listeners: `Event.fake([UserRegistered])`.

Details: [Events](/docs/1.x/events).

## Mail

```ts
import { Mail } from "@bunyad/mail";

Mail.fake();

await this.postJson("/register", { /* … */ });

Mail.assertSent(WelcomeMail);
Mail.assertSent((m) => String(m.to).includes("ada@example.com"));
Mail.assertSentCount(1);
Mail.assertNothingSent();

Mail.restore();
```

Details: [Mail](/docs/1.x/mail).

## Notifications

```ts
import { Notification } from "@bunyad/notifications";

Notification.fake();

Notification.assertSentTo(user, WelcomeNotification);
Notification.assertSentTimes(WelcomeNotification, 1);
Notification.assertSentOnDemand(OnDemandNote);
Notification.assertNothingSent();
```

Details: [Notifications](/docs/1.x/notifications).

## Queues

```ts
import { Queue } from "@bunyad/queue";

Queue.fake();

await dispatch(new ProcessPodcast(podcast));

Queue.assertPushed(ProcessPodcast);
Queue.assertPushed(ProcessPodcast, (job) => job.queue === "podcasts");
Queue.assertPushedTimes(ProcessPodcast, 1);
Queue.assertNothingPushed();
```

Details: [Queues](/docs/1.x/queues).

## Cache

```ts
import { Cache } from "@bunyad/cache";

Cache.fake();

await Cache.put("user:1", { name: "Ada" });

await Cache.assertHas("user:1");
await Cache.assertHasValue("user:1", { name: "Ada" });
await Cache.assertMissing("gone");

Cache.restore();
```

Details: [Cache](/docs/1.x/cache).

## Storage

```ts
import { Storage } from "@bunyad/filesystem";

const fake = Storage.fake(); // or Storage.fake("s3")

await Storage.put("avatars/ada.png", bytes);

fake.assertExists("avatars/ada.png");
fake.assertMissing("avatars/missing.png");
fake.assertDirectoryEmpty("tmp");
```

Details: [File Storage](/docs/1.x/filesystem).


## Container stubs

Replace a bound service for one test:

```ts
this.app.instance(PaymentGateway, {
  charge: async () => ({ id: "ch_test" }),
});
```

Prefer fakes for facades. Use `instance` when the code under test resolves a concrete class from the [container](/docs/1.x/container).

## Uploaded files

Build a fake upload without touching disk:

```ts
import { UploadedFile } from "@bunyad/http";

const file = UploadedFile.fake().create("avatar.png", "…", "image/png");
```
