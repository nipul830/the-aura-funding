INSERT INTO site_faq(question,answer,sort_order)
SELECT * FROM (VALUES
('What is THE AURA FUNDING?','THE AURA FUNDING provides structured trading challenges with clear risk rules. Choose a challenge, trade within its limits and qualify for a funded account.',1),
('What challenge types are available?','Challenge availability is controlled from the admin panel. The platform can offer 2 STEP, 1 STEP and INSTANT plans, with LITE or PRO variants when configured.',2),
('How do I choose a plan?','Open Plans, select your challenge type and account size, review the rules and challenge fee, then continue to checkout.',3),
('How does the payment process work?','After selecting a plan, submit the required payment details and transaction ID. Your payment enters the admin Payment Queue for review.',4),
('How long does payment approval take?','Payments are reviewed by the admin team. Once approved, the funded trading account is created automatically according to the selected plan and rule version.',5),
('What are the risk management rules?','Every account is controlled by server-side risk rules such as daily drawdown, maximum drawdown, floating loss, profit target and minimum trading days. Exact values are shown with each plan.',6),
('Which trading platform is supported?','THE AURA FUNDING trading terminal is being built as the platform trading environment. Additional broker or platform integrations can be enabled later.',7),
('Do you provide support?','Yes. Use the Contact Us section for support email, WhatsApp or Telegram. Contact details are managed by the admin team.',8)
) AS v(question,answer,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM site_faq WHERE site_faq.question=v.question);

INSERT INTO success_stories(name,account_type,profit_amount,image_url,quote,sort_order)
SELECT * FROM (VALUES
('Rahul S.','10K · 2 STEP LITE',642.35,'https://i.pravatar.cc/300?img=12','Illustrative trader profile — sample success story for the AURA website.',1),
('Nikhil T.','25K · 1 STEP PRO',1284.50,'https://i.pravatar.cc/300?img=33','Illustrative trader profile — sample success story for the AURA website.',2)
) AS v(name,account_type,profit_amount,image_url,quote,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM success_stories WHERE name=v.name AND account_type=v.account_type);
