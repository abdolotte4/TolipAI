import { useState } from "react";
import { motion } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { MapPin, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useSubmitContact } from "@workspace/api-client-react";

const contactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  company: z.string().optional(),
  phone: z.string().optional(),
  service: z.string().optional(),
  message: z.string().min(1, "Message is required"),
});

type ContactFormValues = z.infer<typeof contactSchema>;

export function Contact() {
  const { toast } = useToast();
  const [isSuccess, setIsSuccess] = useState(false);
  
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      phone: "",
      service: "",
      message: "",
    },
  });

  const submitMutation = useSubmitContact({
    mutation: {
      onSuccess: () => {
        setIsSuccess(true);
        form.reset();
        toast({
          title: "Inquiry Sent",
          description: "We've received your message and will be in touch shortly.",
        });
        setTimeout(() => setIsSuccess(false), 5000);
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "Submission Failed",
          description: "There was an error sending your message. Please try again.",
        });
      }
    }
  });

  const onSubmit = (data: ContactFormValues) => {
    submitMutation.mutate({ data });
  };

  return (
    <section id="contact" className="py-24 bg-card border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">Schedule a Consultation</h2>
            <div className="w-20 h-1 bg-primary rounded-full mb-8" />
            <p className="text-lg text-muted-foreground mb-12">
              Ready to scale your acquisition operations? Contact us to discuss how our managed infrastructure can align with your operational goals.
            </p>

            <div className="space-y-8">
              <div className="flex items-start space-x-4">
                <div className="bg-secondary p-3 rounded-lg text-primary">
                  <MapPin className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground text-lg mb-1">Headquarters</h4>
                  <p className="text-muted-foreground">1095 Sugar View Dr Ste 500<br />Sheridan, WY 82801</p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="bg-secondary p-3 rounded-lg text-primary">
                  <Mail className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground text-lg mb-1">Email</h4>
                  <p className="text-muted-foreground">info@tolipai.com</p>
                </div>
              </div>

              <div className="flex items-start space-x-4">
                <div className="bg-secondary p-3 rounded-lg text-primary">
                  <Phone className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-semibold text-foreground text-lg mb-1">Phone</h4>
                  <p className="text-muted-foreground">(555) 201-4892<br />(555) 307-6148</p>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="bg-background border border-border p-8 rounded-2xl shadow-xl shadow-black/20"
          >
            {isSuccess ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12">
                <div className="w-16 h-16 bg-primary/20 text-primary rounded-full flex items-center justify-center mb-6">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-foreground mb-2">Message Received</h3>
                <p className="text-muted-foreground">Thank you for your interest. A representative will contact you shortly.</p>
              </div>
            ) : (
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Full Name *</label>
                    <Input 
                      {...form.register("name")} 
                      placeholder="John Doe"
                      className="bg-secondary border-border focus:border-primary"
                    />
                    {form.formState.errors.name && (
                      <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Email Address *</label>
                    <Input 
                      {...form.register("email")} 
                      type="email" 
                      placeholder="john@example.com"
                      className="bg-secondary border-border focus:border-primary"
                    />
                    {form.formState.errors.email && (
                      <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Company Name</label>
                    <Input 
                      {...form.register("company")} 
                      placeholder="Acme Real Estate"
                      className="bg-secondary border-border focus:border-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Phone Number</label>
                    <Input 
                      {...form.register("phone")} 
                      placeholder="(555) 123-4567"
                      className="bg-secondary border-border focus:border-primary"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Service of Interest</label>
                  <select 
                    {...form.register("service")}
                    className="flex h-10 w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                  >
                    <option value="">Select a service...</option>
                    <option value="data-engineering">Data Engineering</option>
                    <option value="managed-outreach">Managed Outreach Operations</option>
                    <option value="crm-infrastructure">Technical CRM Infrastructure</option>
                    <option value="full-suite">Full Suite Managed Infrastructure</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Message *</label>
                  <Textarea 
                    {...form.register("message")} 
                    placeholder="Tell us about your acquisition operational needs..."
                    className="min-h-[120px] bg-secondary border-border focus:border-primary"
                  />
                  {form.formState.errors.message && (
                    <p className="text-xs text-destructive">{form.formState.errors.message.message}</p>
                  )}
                </div>

                <Button 
                  type="submit" 
                  disabled={submitMutation.isPending}
                  className="w-full h-12 text-lg font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {submitMutation.isPending ? "Sending..." : "Send Inquiry"}
                </Button>
              </form>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
